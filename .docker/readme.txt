meteor build --server-only --directory /tmp/rc-build
cp .docker/Dockerfile /tmp/rc-build
cd /tmp/rc-build
docker ps
docker stop <container id of mongo>
docker stop <container id of rocketchat>
docker image rm -f <image id of rocketchat>
docker build -t rocketchat/rocket.chat:3.10.0 .
cd ~/rocketchat
docker-compose up -d