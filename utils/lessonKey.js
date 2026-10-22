function toIdString(value) {
  return value == null ? null : String(value);
}

// The key a lesson goes by everywhere: in the learning path, in progress records and in practice progress.
function getLessonKey({ topicId, subtopicId }) {
  if (subtopicId) {
    return `subtopic:${toIdString(subtopicId)}`;
  }

  if (topicId) {
    return `topic:${toIdString(topicId)}`;
  }

  return null;
}

module.exports = { toIdString, getLessonKey };
