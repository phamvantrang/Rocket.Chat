import { Meteor } from 'meteor/meteor';

import { Users, TeleHistory } from '../../../models/server';

const TelegramBot = require('node-telegram-bot-api');

// change to process.env.TELEGRAM_BOT_TOKEN
const token = process.env.TELEGRAM_BOT_TOKEN || '1501999697:AAET7tJpxMwJ1Z8UPkULLWaAVSy716wKVoc';
// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(token, { polling: true });

const MAX_MSG_PER_SECOND = 25; // https://core.telegram.org/bots/faq#:~:text=If%20you're%20sending%20bulk,minute%20to%20the%20same%20group.
// change to process.env.FETCH_MSG_QUEUE_DELAY_MS
const FETCH_MSG_QUEUE_DELAY_MS = process.env.FETCH_MSG_QUEUE_DELAY_MS || 5000; // fetch message queue each 5 seconds

const msgQueue = new Map();

async function saveTeleHistory(telegram_id, message_id, timestamp) {
	const history = {
		tele_id: telegram_id,
		msg_id: message_id,
		tm: timestamp,
	};
	return TeleHistory.model.rawCollection().insert(history);
}

async function clearOldChatHistory() {
	const anchorTime = parseInt(Date.now() / 1000) - 12 * 3600; // find record older than 12 hours
	const oldRecords = await TeleHistory.model.rawCollection().find({ tm: { $lte: anchorTime } }, { tele_id: 1, msg_id: 1 })
		.limit(MAX_MSG_PER_SECOND).toArray();
	if (oldRecords && oldRecords.length > 0) {
		const deletedIds = [];
		for (const r of oldRecords) {
			deletedIds.push(r._id);
			try {
				bot.deleteMessage(r.tele_id, r.msg_id);
			} catch (err) {
				console.log('Telebot delete failed ', err);
			}
		}
		TeleHistory.model.rawCollection().deleteMany({ _id: { $in: deletedIds } });
	}
}

async function notifyToBot(telegram_id) {
	// console.log('telegram_id', telegram_id);
	try {
		bot.sendMessage(telegram_id, 'You have a new message').then((res) => {
			saveTeleHistory(res.chat.id, res.message_id, res.date);
		});
	} catch (err) {
		console.log('Telebot send failed ', err);
	}
}

function sendMsgFromQueue() {
	if (msgQueue.size > 0) {
		// Fetch limit msg then send
		let count = 0;
		// eslint-disable-next-line no-unused-vars
		for (const [key, value] of msgQueue) {
			count++;
			if (count > MAX_MSG_PER_SECOND) {
				break;
			}
			msgQueue.delete(key);
			notifyToBot(key);
		}
	}
}

async function sendMsgFromQueueInterval() {
	sendMsgFromQueue();
	await new Promise((resolve) => setTimeout(resolve, 1000));
	clearOldChatHistory();
	setTimeout(sendMsgFromQueueInterval, FETCH_MSG_QUEUE_DELAY_MS);
}
sendMsgFromQueueInterval();

// Matches "/rocket [rocker user name]"
bot.onText(/\/rocket (.+)/, Meteor.bindEnvironment((msg, match) => {
	const in_tele_id = msg.chat.id;
	const in_tele_user = msg.chat.username;
	const username = match[1]; // the captured "whatever"
	const fullFields = {
		telegram_id: 1,
		telegram_user: 1,
		username: 1,
	};
	const options = {
		fullFields,
	};
	const user = username && Users.findOneByUsername(username, options);
	let response = `Rocket user ${ username } is not found. Fail to link with Telegram user ${ in_tele_user }`;
	if (user) {
		if (user.telegram_id && user.telegram_id !== in_tele_id) {
			// Send notice to old telegram user
			const notice = `!IMPORTANT! Rocket user ${ username } has new linkage Telegram user ${ in_tele_user }`;
			bot.sendMessage(user.telegram_id, notice);
		}
		// One rocket user only link with one telegram user => unset old record
		Users.update({ telegram_id: in_tele_id }, { $unset: { telegram_id: 1, telegram_user: 1 } });
		Users.update({ _id: user._id }, { $set: { telegram_id: in_tele_id, telegram_user: in_tele_user } });
		response = `Success to link Rocket user ${ username } with Telegram user ${ in_tele_user }`;
	}
	try {
		// send back the content to the chat
		bot.sendMessage(in_tele_id, response);
	} catch (err) {
		console.log('Telebot send failed ', err);
	}
}));

// Matches "/unrocket"
bot.onText(/\/unrocket/, Meteor.bindEnvironment((msg) => {
	const in_tele_id = msg.chat.id;
	Users.update({ telegram_id: in_tele_id }, { $unset: { telegram_id: 1, telegram_user: 1 } });
	try {
		// send back the content to the chat
		bot.sendMessage(in_tele_id, 'Unlinked Telegram with Rocket');
	} catch (err) {
		console.log('Telebot send failed ', err);
	}
}));

// Matches "/start"
bot.onText(/\/start/, Meteor.bindEnvironment((msg) => {
	const in_tele_id = msg.chat.id;
	try {
		// send back the content to the chat
		let msg = '';
		msg += '/start : To show available commands.\n';
		msg += '/rocket rocket_user : To link rocket chat nofitication with your telegram.\n';
		msg += '/unrocket : To unlink your telegram with Rocket.';

		bot.sendMessage(in_tele_id, msg);
	} catch (err) {
		console.log('Telebot send failed ', err);
	}
}));


export function addMsgToTelegramQueue(user) {
	if (user && user.tele && user.tele.telegram_id) {
		msgQueue.set(user.tele.telegram_id, 1);
	}
}
