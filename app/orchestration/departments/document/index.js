'use strict';

// Document Department — registry가 참조하는 진입점. 다른 department를 추가할
// 때는 이 파일과 같은 모양(intake/evidence/plan/validator/extractor/qa/
// finalizer 서브모듈을 모아 하나의 객체로 export)으로 만들면 된다.
const intake = require('./intake');
const evidence = require('./evidence');
const plan = require('./plan');
const validator = require('./validator');
const extractor = require('./extractor');
const qa = require('./qa');
const finalizer = require('./finalizer');
const hooks = require('./hooks');

module.exports = {
  id: 'document',
  intake,
  evidence,
  plan,
  validator,
  extractor,
  qa,
  finalizer,
  hooks,
};
