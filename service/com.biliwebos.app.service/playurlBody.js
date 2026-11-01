// Shared envelope handling for legacy UGC/PGC and nested PGC v2 responses.
module.exports = function (response) {
  var outer = response && (response.data || response.result) || {};
  var inner = outer.video_info;
  if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return outer;
  var result = {};
  Object.keys(outer).forEach(function (key) { result[key] = outer[key]; });
  Object.keys(inner).forEach(function (key) { result[key] = inner[key]; });
  return result;
};
