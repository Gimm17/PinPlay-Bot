const fetch = require("node-fetch"); // node v22 has global fetch, but let's use global fetch

async function run() {
  const clientId = "8ff89b50f9de4b66bbcf3373cade2823";
  const clientSecret = "a0a3e7e6e87643caaae4d2e3c40013b1";
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const resToken = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!resToken.ok) {
    console.log("Token Failed:", await resToken.text());
    return;
  }

  const tokenData = await resToken.json();
  console.log("Got Token:", tokenData.access_token.substring(0, 10) + "...");

  const resApi = await fetch("https://api.spotify.com/v1/playlists/64xeX4XWAuayp46b4u5YhA", {
    headers: { "Authorization": `Bearer ${tokenData.access_token}` },
  });

  if (!resApi.ok) {
    console.log("API Failed:", await resApi.text());
    return;
  }

  const apiData = await resApi.json();
  console.log("Success! Tracks:", apiData.tracks.items.length);
}

run();
