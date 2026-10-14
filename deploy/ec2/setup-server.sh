#!/bin/sh
# One-time setup for a fresh Ubuntu EC2 instance. Run it as the default "ubuntu" user:
#   sh setup-server.sh
set -eu

echo "Installing Docker Engine and the Compose plugin (official install script)..."
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"

# A 1 GB instance can run out of memory during image updates; swap is the safety margin.
if [ ! -f /swapfile ]; then
  echo "Adding 2 GB of swap..."
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "Creating /opt/iitr-chess..."
sudo mkdir -p /opt/iitr-chess
sudo chown "$USER":"$USER" /opt/iitr-chess

echo
echo "Done. Log out and back in (so the docker group applies), then create"
echo "/opt/iitr-chess/.env, api.env and web.env as described in deploy/ec2/README.md."
