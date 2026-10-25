const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOrigins, isOriginAllowed, buildCorsOptions } = require('../utils/cors');

test('the list of allowed sites is read from a comma-separated setting', () => {
  assert.deepEqual(parseOrigins(' https://a.example , https://b.example/ ,, '), ['https://a.example', 'https://b.example']);
  assert.deepEqual(parseOrigins(undefined), []);
  assert.deepEqual(parseOrigins(''), []);
});

test('the mobile app, which sends no Origin, is always allowed', () => {
  assert.equal(isOriginAllowed(undefined, []), true);
  assert.equal(isOriginAllowed('', []), true);
});

test('only listed sites and the developer machine are allowed from a browser', () => {
  const allowed = ['https://c3.example'];
  assert.equal(isOriginAllowed('https://c3.example', allowed), true);
  assert.equal(isOriginAllowed('http://localhost:8081', allowed), true);
  assert.equal(isOriginAllowed('http://127.0.0.1:3000', allowed), true);
  assert.equal(isOriginAllowed('https://evil.example', allowed), false);
  assert.equal(isOriginAllowed('https://c3.example.evil.example', allowed), false, 'a longer host is not the listed one');
  assert.equal(isOriginAllowed('http://localhost.evil.example', allowed), false);
  assert.equal(isOriginAllowed('https://c3.example', []), false, 'nothing is allowed until it is listed');
});

test('the cors option answers with the decision', () => {
  const { origin } = buildCorsOptions({ CORS_ORIGINS: 'https://c3.example' });
  const decide = (value) => {
    let result;
    origin(value, (err, allowed) => {
      assert.equal(err, null);
      result = allowed;
    });
    return result;
  };
  assert.equal(decide('https://c3.example'), true);
  assert.equal(decide('https://other.example'), false);
  assert.equal(decide(undefined), true);
});
