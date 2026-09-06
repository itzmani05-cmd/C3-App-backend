const mongoose = require('mongoose');
const Unit = require('../models/Unit');
const Topic = require('../models/Topic');
const Subtopic = require('../models/Subtopic');
const Progress = require('../models/Progress');

function sortBySequence(left, right) {
  const leftSequence = Number.isFinite(Number(left?.order))
    ? Number(left.order)
    : 0;
  const rightSequence = Number.isFinite(Number(right?.order))
    ? Number(right.order)
    : 0;

  if (leftSequence !== rightSequence) {
    return leftSequence - rightSequence;
  }

  return String(left?.name || '').localeCompare(String(right?.name || ''), undefined, {
    sensitivity: 'base',
  });
}

function toIdString(value) {
  return value == null ? null : String(value);
}

function getLessonKey({ topicId, subtopicId }) {
  if (subtopicId) {
    return `subtopic:${toIdString(subtopicId)}`;
  }

  if (topicId) {
    return `topic:${toIdString(topicId)}`;
  }

  return null;
}

function buildProgressMap(progressDocs = []) {
  return new Map(
    progressDocs
      .map((item) => [getLessonKey(item), item])
      .filter(([key]) => Boolean(key))
  );
}

function groupById(items, keyName) {
  return items.reduce((acc, item) => {
    const key = toIdString(item?.[keyName]);
    if (!key) {
      return acc;
    }

    if (!acc.has(key)) {
      acc.set(key, []);
    }

    acc.get(key).push(item);
    return acc;
  }, new Map());
}

async function fetchActiveContentTree({ examId } = {}) {
  const unitFilter = { isActive: { $ne: false } };
  if (examId && mongoose.Types.ObjectId.isValid(String(examId))) {
    unitFilter.examId = examId;
  }

  const [units, topics, subtopics] = await Promise.all([
    Unit.find(unitFilter).lean(),
    Topic.find({ isActive: { $ne: false } }).lean(),
    Subtopic.find({ isActive: { $ne: false } }).lean(),
  ]);

  const sortedUnits = [...units].sort(sortBySequence);
  const topicsByUnitId = groupById([...topics].sort(sortBySequence), 'unitId');
  const subtopicsByTopicId = groupById([...subtopics].sort(sortBySequence), 'topicId');

  const structuredUnits = [];
  const lessons = [];

  sortedUnits.forEach((unit) => {
    const unitId = toIdString(unit._id);
    const unitTopics = topicsByUnitId.get(unitId) || [];

    const structuredTopics = unitTopics.map((topic) => {
      const topicId = toIdString(topic._id);
      const unitTopicSubtopics = subtopicsByTopicId.get(topicId) || [];

      const structuredSubtopics = unitTopicSubtopics.map((subtopic) => {
        const lesson = {
          key: getLessonKey({ subtopicId: subtopic._id }),
          type: 'subtopic',
          unitId,
          unitName: unit.name || 'Unit',
          topicId,
          topicName: topic.name || 'Topic',
          subtopicId: toIdString(subtopic._id),
          subtopicName: subtopic.name || 'Subtopic',
          order: subtopic.order,
        };

        lessons.push(lesson);

        return {
          ...subtopic,
          _id: subtopic._id,
          key: lesson.key,
          unitId,
          topicId,
        };
      });

      if (structuredSubtopics.length === 0) {
        lessons.push({
          key: getLessonKey({ topicId: topic._id }),
          type: 'topic',
          unitId,
          unitName: unit.name || 'Unit',
          topicId,
          topicName: topic.name || 'Topic',
          subtopicId: null,
          subtopicName: null,
          order: topic.order,
        });
      }

      return {
        ...topic,
        _id: topic._id,
        key: getLessonKey({ topicId: topic._id }),
        unitId,
        isDirectLesson: structuredSubtopics.length === 0,
        subtopics: structuredSubtopics,
      };
    });

    structuredUnits.push({
      ...unit,
      _id: unit._id,
      unitId,
      topics: structuredTopics,
    });
  });

  return {
    units: structuredUnits,
    lessons,
  };
}

function applyProgressToTree(contentTree, progressDocs = []) {
  const progressMap = buildProgressMap(progressDocs);
  const lessonStateMap = new Map();
  const lessons = [];

  contentTree.lessons.forEach((lesson, index) => {
    const progressDoc = progressMap.get(lesson.key);
    const previousLesson = index > 0 ? lessons[index - 1] : null;

    const isFirstInUnit = !previousLesson || previousLesson.unitId !== lesson.unitId;

    const isCleared = Boolean(progressDoc?.isCleared);
    const isSequentiallyUnlocked =
      isFirstInUnit ||
      Boolean(previousLesson?.isCleared && previousLesson?.isSequentiallyUnlocked);

    const isUnlocked = isSequentiallyUnlocked || isCleared;

    const lessonState = {
      ...lesson,
      isSequentiallyUnlocked,
      isUnlocked,
      isCleared,
      isMastered: Boolean(progressDoc?.isMastered),
      bestScore: progressDoc?.bestScore || 0,
      lastAttempted: progressDoc?.lastAttempted || null,
    };

    lessons.push(lessonState);
    lessonStateMap.set(lesson.key, lessonState);
  });

  const units = contentTree.units.map((unit) => {
    const topics = unit.topics.map((topic) => {
      if (topic.subtopics.length > 0) {
        const subtopics = topic.subtopics.map((subtopic) => {
          const lessonState = lessonStateMap.get(subtopic.key) || {};

          return {
            ...subtopic,
            isUnlocked: Boolean(lessonState.isUnlocked),
            isCleared: Boolean(lessonState.isCleared),
            isMastered: Boolean(lessonState.isMastered),
            bestScore: lessonState.bestScore || 0,
            lastAttempted: lessonState.lastAttempted || null,
          };
        });

        const firstLesson = subtopics[0];

        return {
          ...topic,
          subtopics,
          isUnlocked: Boolean(firstLesson?.isUnlocked || subtopics.some((item) => item.isCleared)),
          isCleared: subtopics.length > 0 && subtopics.every((item) => item.isCleared),
        };
      }

      const lessonState = lessonStateMap.get(topic.key) || {};

      return {
        ...topic,
        subtopics: [],
        isUnlocked: Boolean(lessonState.isUnlocked),
        isCleared: Boolean(lessonState.isCleared),
        isMastered: Boolean(lessonState.isMastered),
        bestScore: lessonState.bestScore || 0,
        lastAttempted: lessonState.lastAttempted || null,
      };
    });

    const unitLessons = lessons.filter((lesson) => lesson.unitId === unit.unitId);
    const firstUnitLesson = unitLessons[0];

    return {
      ...unit,
      topics,
      isUnlocked: Boolean(firstUnitLesson?.isUnlocked || unitLessons.some((item) => item.isCleared)),
      isCleared: unitLessons.length > 0 && unitLessons.every((item) => item.isCleared),
    };
  });

  return {
    units,
    lessons,
  };
}

async function getLearningPathForUser(userId, { examId } = {}) {
  const contentTree = await fetchActiveContentTree({ examId });

  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
    return applyProgressToTree(contentTree, []);
  }

  const progressDocs = await Progress.find({ userId }).lean();
  return applyProgressToTree(contentTree, progressDocs);
}

async function getNextLesson({ currentTopicId, currentSubtopicId, userId } = {}) {
  const learningPath = await getLearningPathForUser(userId);
  const currentKey = getLessonKey({
    topicId: currentTopicId,
    subtopicId: currentSubtopicId,
  });

  const currentIndex = learningPath.lessons.findIndex((lesson) => lesson.key === currentKey);

  if (currentIndex === -1 || currentIndex + 1 >= learningPath.lessons.length) {
    return null;
  }

  return learningPath.lessons[currentIndex + 1];
}

module.exports = {
  getLessonKey,
  getLearningPathForUser,
  getNextLesson,
};
