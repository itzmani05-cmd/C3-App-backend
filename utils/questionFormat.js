function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isLetterKey(key) {
  return /^[a-z]$/i.test(String(key || '').trim());
}

function isNumericKey(key) {
  return /^\d+$/.test(String(key || '').trim());
}

function getOrderedObjectKeys(rawObject) {
  if (!isPlainObject(rawObject)) {
    return [];
  }

  const keys = Object.keys(rawObject);

  return [...keys].sort((left, right) => {
    const leftKey = String(left).trim();
    const rightKey = String(right).trim();

    if (isLetterKey(leftKey) && isLetterKey(rightKey)) {
      return leftKey.localeCompare(rightKey, undefined, { sensitivity: 'base' });
    }

    if (isNumericKey(leftKey) && isNumericKey(rightKey)) {
      return Number(leftKey) - Number(rightKey);
    }

    if (isLetterKey(leftKey)) {
      return -1;
    }

    if (isLetterKey(rightKey)) {
      return 1;
    }

    if (isNumericKey(leftKey)) {
      return -1;
    }

    if (isNumericKey(rightKey)) {
      return 1;
    }

    return leftKey.localeCompare(rightKey, undefined, { sensitivity: 'base' });
  });
}

function looksLikeKeyedOptions(rawOptions) {
  const keys = getOrderedObjectKeys(rawOptions);
  return keys.length > 0 && keys.every((key) => isLetterKey(key));
}

function normalizeNumericCorrectAnswer(value, rawOptions, optionsLength) {
  const numericValue = Math.round(Number(value));

  if (!Number.isFinite(numericValue) || optionsLength <= 0) {
    return -1;
  }

  const zeroBasedMatch = numericValue >= 0 && numericValue < optionsLength;
  const oneBasedMatch = numericValue >= 1 && numericValue <= optionsLength;

  if (zeroBasedMatch && !oneBasedMatch) {
    return numericValue;
  }

  if (oneBasedMatch && !zeroBasedMatch) {
    return numericValue - 1;
  }

  if (zeroBasedMatch && oneBasedMatch) {
    return looksLikeKeyedOptions(rawOptions) ? numericValue - 1 : numericValue;
  }

  return -1;
}

function getOptionText(option) {
  if (typeof option === 'string') {
    return option;
  }

  if (option == null) {
    return '';
  }

  if (typeof option === 'object') {
    return option.text || option.label || '';
  }

  return String(option);
}

function normalizeQuestionOptions(rawOptions) {
  if (Array.isArray(rawOptions)) {
    return rawOptions;
  }

  if (!isPlainObject(rawOptions)) {
    return [];
  }

  return getOrderedObjectKeys(rawOptions).map((key) => rawOptions[key]);
}

function normalizeQuestionOptionImages(rawOptionImages, rawOptions) {
  if (Array.isArray(rawOptionImages)) {
    return rawOptionImages;
  }

  if (!isPlainObject(rawOptionImages)) {
    return [];
  }

  const orderedKeys = looksLikeKeyedOptions(rawOptions)
    ? getOrderedObjectKeys(rawOptions)
    : getOrderedObjectKeys(rawOptionImages);

  return orderedKeys.map((key) => rawOptionImages[key] || '');
}

function getCorrectOptionIndex(question) {
  const rawOptions = question?.options;
  const options = normalizeQuestionOptions(rawOptions);

  if (options.length === 0) {
    return -1;
  }

  const objectOptionIndex = options.findIndex(
    (option) => typeof option === 'object' && option?.isCorrect
  );
  if (objectOptionIndex !== -1) {
    return objectOptionIndex;
  }

  const correctAnswer = question?.correctAnswer || question?.correct_answer;

  if (typeof correctAnswer === 'number' && Number.isFinite(correctAnswer)) {
    return normalizeNumericCorrectAnswer(correctAnswer, rawOptions, options.length);
  }

  if (typeof correctAnswer === 'string') {
    const trimmedAnswer = correctAnswer.trim();

    if (/^\d+$/.test(trimmedAnswer)) {
      return normalizeNumericCorrectAnswer(trimmedAnswer, rawOptions, options.length);
    }

    if (isLetterKey(trimmedAnswer)) {
      const orderedKeys = looksLikeKeyedOptions(rawOptions)
        ? getOrderedObjectKeys(rawOptions)
        : [];
      const keyedIndex = orderedKeys.findIndex(
        (key) => key.toLowerCase() === trimmedAnswer.toLowerCase()
      );

      if (keyedIndex !== -1) {
        return keyedIndex;
      }

      const alphabetIndex = trimmedAnswer.toLowerCase().charCodeAt(0) - 97;
      if (alphabetIndex >= 0 && alphabetIndex < options.length) {
        return alphabetIndex;
      }
    }

    const textMatchIndex = options.findIndex(
      (option) => getOptionText(option).trim() === trimmedAnswer
    );
    if (textMatchIndex !== -1) {
      return textMatchIndex;
    }
  }

  return -1;
}

function normalizeQuestion(question) {
  const options = normalizeQuestionOptions(question?.options);
  const optionImages = normalizeQuestionOptionImages(question?.optionImages, question?.options);
  const correctOptionIndex = getCorrectOptionIndex(question);

  return {
    ...question,
    options,
    optionImages,
    correctAnswer: correctOptionIndex >= 0 ? correctOptionIndex : question?.correctAnswer,
  };
}

module.exports = {
  getCorrectOptionIndex,
  getOptionText,
  normalizeQuestion,
  normalizeQuestionOptionImages,
  normalizeQuestionOptions,
};
