#!/usr/bin/env bash
# Build the ESP32's copy of the website in www/ (git ignores it): the real
# website's files from ../website/web, then web/ from here on top of them
# (firebase.js that talks to the ESP32 instead of Firebase, and pumps.html).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf www
mkdir www
cp ../website/web/* www/
cp web/* www/
