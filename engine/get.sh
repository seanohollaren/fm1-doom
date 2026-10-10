#!/bin/sh
# Fetch upstream rp2040-doom at the commit the FM-1 work is based on and apply that work (engine/rp2040-doom/*.patch).
set -e
cd "$(dirname "$0")/.."
BASE=29a453c980918a03e40fc8b69b024e7a3bdb5dc2
if [ -d rp2040-doom/.git ]; then
  echo "rp2040-doom already exists: not touching it (branch $(git -C rp2040-doom branch --show-current))"
  exit 0
fi
git clone https://github.com/kilograham/rp2040-doom rp2040-doom
git -C rp2040-doom checkout -q -b fm1-port "$BASE"
git -C rp2040-doom am --quiet "$PWD"/engine/rp2040-doom/*.patch
echo "rp2040-doom: fm1-port at $(git -C rp2040-doom rev-parse --short HEAD), $(ls engine/rp2040-doom/*.patch | wc -l | tr -d ' ') commits on $BASE"
