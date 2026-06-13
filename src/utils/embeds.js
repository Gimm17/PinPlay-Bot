/**
 * Shared embed reply helpers for PinPlay.
 * Bikin semua message bot konsisten pakai embed dengan side box berwarna,
 * bukan plain text. Dipakai di semua command biar UI serasi.
 */
const { EmbedBuilder } = require("discord.js");
const { Colors } = require("./colors");

/**
 * Bikin embed sederhana dengan 1 baris pesan + warna side box.
 * @param {string} message - Teks utama (boleh markdown)
 * @param {number} color - Warna side box (dari Colors)
 * @returns {EmbedBuilder}
 */
function simpleEmbed(message, color = Colors.INFO) {
  return new EmbedBuilder().setColor(color).setDescription(message);
}

/** Embed sukses (pink-ish secondary). */
function successEmbed(message) {
  return simpleEmbed(message, Colors.SUCCESS);
}

/** Embed info (biru primary). */
function infoEmbed(message) {
  return simpleEmbed(message, Colors.INFO);
}

/** Embed error (rose red). */
function errorEmbed(message) {
  return simpleEmbed(message, Colors.ERROR);
}

/** Embed warning (secondary). */
function warningEmbed(message) {
  return simpleEmbed(message, Colors.WARNING);
}

module.exports = { simpleEmbed, successEmbed, infoEmbed, errorEmbed, warningEmbed };
