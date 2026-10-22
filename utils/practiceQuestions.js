// Mixes several lists of practice questions into one random selection of at most `size`.
function mixPracticeQuestions(lists, size, random = Math.random) {
    const all = lists.flat();
    for (let i = all.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [all[i], all[j]] = [all[j], all[i]];
    }
    return all.slice(0, size);
}

module.exports = { mixPracticeQuestions };
