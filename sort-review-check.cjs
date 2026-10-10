const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const start = html.indexOf('<script>') + '<script>'.length;
const end = html.indexOf('</script>', start);
assert(start >= '<script>'.length && end > start);
const script = html.slice(start, end);
for (const match of script.matchAll(/getElementById\('([^']+)'\)/g)) {
  assert(html.includes(`id="${match[1]}"`), `Missing HTML element: ${match[1]}`);
}

const elements = new Map();
function element(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      hidden: true,
      value: '',
      textContent: '',
      listeners: {},
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
      addEventListener(name, listener) { this.listeners[name] = listener; },
      querySelectorAll() { return []; },
      replaceChildren() {},
      focus() {}
    });
  }
  return elements.get(id);
}

const storage = new Map();
let failSortWrite = false;
const localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) {
    if (failSortWrite && key === 'sui-bu-sui-todo:sort:v1') throw Error('storage denied');
    storage.set(key, value);
  }
};

class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-10-09T12:00:00'])); }
}

const document = {
  getElementById: element,
  createDocumentFragment() { return { append() {} }; },
  removeEventListener() {},
  body: { classList: { remove() {} } }
};
const window = {
  matchMedia() { return { matches: true }; },
  removeEventListener() {}
};
const context = vm.createContext({
  document, window, localStorage, Date: FixedDate,
  cancelAnimationFrame() {}, requestAnimationFrame() { return 1; }
});
vm.runInContext(script, context);
const evaluate = source => vm.runInContext(source, context);

assert.equal(evaluate('sortMode'), 'auto');
assert.equal(element('sort-switch').attributes['aria-checked'], 'false');
element('sort-switch').listeners.click();
assert.equal(evaluate('sortMode'), 'manual');
assert.equal(JSON.parse(storage.get('sui-bu-sui-todo:sort:v1')).mode, 'manual');
element('sort-switch').listeners.click();
assert.equal(evaluate('sortMode'), 'auto');

evaluate(`tasks.push(
  {id:1,dateTime:'2026-10-09T09:00',text:'A',note:'',completed:false},
  {id:2,dateTime:'2026-10-09T10:00',text:'B',note:'',completed:true},
  {id:3,dateTime:'2026-10-09T11:00',text:'C',note:'',completed:false},
  {id:4,dateTime:'2026-10-08T09:00',text:'D',note:'',completed:false},
  {id:5,dateTime:'2026-10-06T09:00',text:'E',note:'',completed:false},
  {id:6,dateTime:'2026-10-08T10:00',text:'F',note:'',completed:true},
  {id:7,dateTime:'2026-09-29T09:00',text:'G',note:'',completed:false}
)`);
assert.equal(evaluate("getAutoOrder('2026-10-09').join(',')"), '1,3,2,4,6,5,7');
assert.equal(evaluate("getVisibleTasks('2026-10-09').map(task => task.id).join(',')"), '1,3,2');

evaluate("sortMode = 'manual'; manualOrder = [2,3,1,7,6,5,4]; currentView = 'home'");
assert.equal(evaluate("getVisibleTasks('2026-10-09').map(task => task.id).join(',')"), '2,3,1');
evaluate("currentView = 'history'");
assert.equal(evaluate("getVisibleTasks('2026-10-09').map(task => task.id).join(',')"), '6,4,5,7');
evaluate("sortMode = 'auto'; currentView = 'home'");
assert.equal(evaluate("getVisibleTasks('2026-10-09').map(task => task.id).join(',')"), '1,3,2');
assert.equal(evaluate('manualOrder.join(",")'), '2,3,1,7,6,5,4');

element('task-list').querySelectorAll = () => [3, 1, 2].map(id => ({
  dataset: { scope: 'home', taskId: String(id) }
}));
evaluate("manualOrder = [1,2,3,4,5,6,7]; commitManualScopeOrder('home')");
assert.equal(evaluate('manualOrder.join(",")'), '3,1,2,4,5,6,7');
assert.deepEqual(JSON.parse(storage.get('sui-bu-sui-todo:sort:v1')).order, [3,1,2,4,5,6,7]);
evaluate("sortMode = 'manual'; saveSortPreferences(); saveTasks()");
const reloaded = vm.createContext({
  document, window, localStorage, Date: FixedDate,
  cancelAnimationFrame() {}, requestAnimationFrame() { return 1; }
});
vm.runInContext(script.replace(/renderTasks\(\);\s*$/, ''), reloaded);
assert.equal(vm.runInContext('sortMode', reloaded), 'manual');
assert.equal(vm.runInContext('manualOrder.join(",")', reloaded), '3,1,2,4,5,6,7');
assert.equal(vm.runInContext('tasks.length', reloaded), 7);

evaluate("sortMode = 'manual'; currentView = 'history'; manualOrder = [4,5,6,7,1,2,3]");
evaluate("tasks.find(task => task.id === 4).dateTime = '2026-10-06T09:00'; moveManualTaskToEnd(4)");
assert.equal(evaluate("getVisibleTasks('2026-10-09').map(task => task.id).join(',')"), '6,5,4,7');

failSortWrite = true;
evaluate('saveSortPreferences()');
assert.equal(element('sort-storage-message').hidden, false);
evaluate('saveTasks()');
assert.equal(element('sort-storage-message').hidden, false);
failSortWrite = false;

storage.set('sui-bu-sui-todo:sort:v1', '{broken');
assert.equal(evaluate('loadSortPreferences().mode'), 'auto');
assert.equal(evaluate('tasks.length'), 7);
assert.equal(element('sort-storage-message').hidden, false);

const rowOrder = [];
function testRow(id, scope) {
  const row = {
    dataset: { taskId: String(id), scope },
    cells: [],
    classList: { add() {}, remove() {} },
    cloneNode() { return { cells: [], classList: { remove() {} } }; },
    getBoundingClientRect() { return { left: 0, top: rowOrder.indexOf(row) * 40, width: 500, height: 40 }; },
    get nextElementSibling() { return rowOrder[rowOrder.indexOf(row) + 1] || null; },
    after(moving) {
      rowOrder.splice(rowOrder.indexOf(moving), 1);
      rowOrder.splice(rowOrder.indexOf(row) + 1, 0, moving);
    }
  };
  return row;
}
const first = testRow(1, 'home');
const second = testRow(2, 'home');
const third = testRow(3, 'home');
const groupHeading = { dataset: {} };
const otherGroup = testRow(4, 'history-0');
rowOrder.push(first, second, third, groupHeading, otherGroup);
element('task-list').querySelectorAll = () => rowOrder.filter(row => row.dataset.taskId);
element('task-list').insertBefore = (moving, before) => {
  rowOrder.splice(rowOrder.indexOf(moving), 1);
  rowOrder.splice(rowOrder.indexOf(before), 0, moving);
};
context.testDragState = { row: first, scope: 'home' };
evaluate('dragState = testDragState; moveRowToPointer(500)');
assert.equal(rowOrder.map(row => row.dataset.taskId || 'heading').join(','), '2,3,1,heading,4');
evaluate('moveRowToPointer(0)');
assert.equal(rowOrder.map(row => row.dataset.taskId || 'heading').join(','), '1,2,3,heading,4');
evaluate('dragState = null');

let capturedOnBody = null;
let releasedFromBody = null;
document.createElement = () => ({
  style: {}, classList: { remove() {} }, setAttribute() {}, append() {}, remove() {},
  getBoundingClientRect() { return { left: 0, top: 0 }; }
});
document.addEventListener = () => {};
window.addEventListener = () => {};
document.body.append = () => {};
document.body.classList.add = () => {};
document.body.addEventListener = () => {};
document.body.removeEventListener = () => {};
document.body.setPointerCapture = id => { capturedOnBody = id; };
document.body.hasPointerCapture = id => capturedOnBody === id;
document.body.releasePointerCapture = id => { releasedFromBody = id; };
context.testRow = first;
context.testPointerEvent = {
  button: 0, pointerId: 24, clientX: 10, clientY: 10, preventDefault() {}
};
evaluate("sortMode = 'manual'; beginDrag(testPointerEvent, testRow)");
assert.equal(capturedOnBody, 24);
assert.equal(evaluate('dragState.captureTarget === document.body'), true);
evaluate('finishDrag(true)');
assert.equal(releasedFromBody, 24);

let releasedPointer = null;
let restored = false;
const originalNext = {};
element('task-list').insertBefore = () => { restored = true; };
context.fakeDragState = {
  row: { classList: { remove() {} } },
  scope: 'home',
  ghost: { getBoundingClientRect() { return { left: 0, top: 0 }; }, remove() {} },
  captureTarget: {
    removeEventListener() {},
    hasPointerCapture() { return true; },
    releasePointerCapture(id) { releasedPointer = id; }
  },
  pointerId: 42,
  originalNext,
  originalPrevious: null,
  scrollFrame: 1,
  startRect: { top: 100, height: 60 },
  startY: 120,
  lastY: 170
};
evaluate('dragState = fakeDragState');
assert.equal(evaluate('getDraggedCenterY()'), 180);
evaluate('onWindowBlur()');
assert.equal(evaluate('dragState'), null);
assert.equal(releasedPointer, 42);
assert.equal(restored, true);

console.log('排序模式、分组、手动顺序、保存异常、拖动边界与取消检查通过');
