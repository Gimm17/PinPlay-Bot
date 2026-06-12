const MAX_QUERY_LENGTH = 300;

/**
 * Validasi query (judul lagu/link)
 */
function validateQuery(raw) {
  if (!raw) return { valid: false, error: "Query kosong." };
  
  const sanitized = raw.trim().replace(/[\x00-\x1F\x7F-\x9F]/g, ""); // strip control chars
  
  if (sanitized.length === 0) {
    return { valid: false, error: "Query kosong atau tidak valid." };
  }

  if (sanitized.length > MAX_QUERY_LENGTH) {
    return { valid: false, error: `Query terlalu panjang (maks ${MAX_QUERY_LENGTH} karakter).` };
  }

  return { valid: true, sanitized, error: null };
}

/**
 * Validasi integer range
 */
function validateIntRange(value, min, max, fieldName = "Value") {
  if (typeof value !== "number" || isNaN(value)) {
    return { valid: false, error: `${fieldName} harus berupa angka.` };
  }
  if (value < min || value > max) {
    return { valid: false, error: `${fieldName} harus antara ${min} dan ${max}.` };
  }
  return { valid: true, error: null };
}

module.exports = {
  validateQuery,
  validateIntRange
};
