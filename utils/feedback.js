const CATEGORIES = ['general', 'bug', 'content', 'suggestion'];
const MIN_MESSAGE_LENGTH = 10;
const MAX_MESSAGE_LENGTH = 1000;

const shortText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

// Checks what the app sends and returns { error } or { value } with the cleaned-up fields. Nothing from the request is
// trusted: lengths are capped, the category must be a known one and the rating a whole number from 1 to 5.
function validateFeedback(body = {}) {
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (message.length < MIN_MESSAGE_LENGTH) {
    return { error: `Please write at least ${MIN_MESSAGE_LENGTH} characters so we can understand your feedback.` };
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { error: `Please keep your feedback under ${MAX_MESSAGE_LENGTH} characters.` };
  }

  const category = body.category == null || body.category === '' ? 'general' : body.category;
  if (!CATEGORIES.includes(category)) {
    return { error: `Category must be one of: ${CATEGORIES.join(', ')}.` };
  }

  let rating = null;
  if (body.rating != null && body.rating !== '') {
    rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return { error: 'Rating must be a whole number from 1 to 5.' };
    }
  }

  return {
    value: {
      message,
      category,
      rating,
      platform: shortText(body.platform, 20),
      appVersion: shortText(body.appVersion, 20),
    },
  };
}

module.exports = { CATEGORIES, MIN_MESSAGE_LENGTH, MAX_MESSAGE_LENGTH, validateFeedback };
