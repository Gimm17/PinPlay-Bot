const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envPath = path.join(__dirname, '.env');
const ymlPath = path.join(__dirname, '../PinPlay-Lavalink/application.yml');

const env = dotenv.parse(fs.readFileSync(envPath));
const spDc = env.SPOTIFY_SP_DC;

if (!spDc) {
  console.log("No SPOTIFY_SP_DC found in .env");
  process.exit(1);
}

let yml = fs.readFileSync(ymlPath, 'utf8');

// remove existing spDc line if present
yml = yml.replace(/\s+spDc:.*?\n/g, '\n');

// insert spDc after clientSecret
yml = yml.replace(
  /(clientSecret:\s*".*?")/g,
  `$1\n      spDc: "${spDc}"`
);

fs.writeFileSync(ymlPath, yml);
console.log("Successfully added spDc to application.yml");
