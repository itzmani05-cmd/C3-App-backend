const NOTIFICATION_TYPES = {
  daily_challenge_published: { category: 'daily_challenge', dataKeys: ['dailyChallengeId'] },
  daily_challenge_reminder: { category: 'daily_challenge', dataKeys: ['dailyChallengeId'] },
  daily_challenge_ending_soon: { category: 'daily_challenge', dataKeys: ['dailyChallengeId'] },

  assignment_new: { category: 'assignment', dataKeys: ['assignmentId'] },
  assignment_deadline: { category: 'assignment', dataKeys: ['assignmentId'] },
  quiz_new: { category: 'quiz', dataKeys: ['quizId'] },
  quiz_deadline: { category: 'quiz', dataKeys: ['quizId'] },

  course_new: { category: 'course', dataKeys: ['courseId', 'moduleId'] },
  material_new: { category: 'material', dataKeys: ['materialId', 'topicId'] },

  announcement: { category: 'announcement', dataKeys: ['announcementId'] },
  important_announcement: { category: 'announcement', dataKeys: ['announcementId'] },
  trainer_message: { category: 'message', dataKeys: ['messageId', 'trainerId'] },
  project_update: { category: 'project', dataKeys: ['projectId'] },
};

const NOTIFICATION_TYPE_KEYS = Object.keys(NOTIFICATION_TYPES);

function isKnownNotificationType(type) {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_TYPES, type);
}

module.exports = { NOTIFICATION_TYPE_KEYS, isKnownNotificationType };
