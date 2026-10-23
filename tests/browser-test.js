// Opens each example in a headless browser and clicks through it.
//
//   npm install
//   npx playwright install chromium
//   npm test
//
// Set WEBAWESOME_DIR=/path/to/@awesome.me/webawesome to serve Web Awesome from a
// local copy instead of the CDN (handy when offline).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const startServer = require('./server');

let failures = 0;
const check = (name, passed) => { console.log(passed ? 'PASS' : 'FAIL', name); if (!passed) failures++; };
const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 5000 });

async function newPage(browser) {
  const page = await browser.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));

  const local = process.env.WEBAWESOME_DIR;
  if (local) {
    await page.route(/cdn\.jsdelivr\.net\/npm\/@awesome\.me\/webawesome@[^/]+\/(.*)$/, (route) => {
      const file = path.join(local, route.request().url().replace(/^.*webawesome@[^/]+\//, ''));
      if (!fs.existsSync(file)) return route.fulfill({ status: 404 });
      route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript' });
    });
    await page.route(/fontawesome\.com/, (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' }));
  }
  return page;
}

async function basicExample(browser, base) {
  console.log('\n# examples/basic');
  const p = await newPage(browser);
  await p.goto(base + '/examples/basic/');
  await until(p, () => document.querySelector('#likes').textContent.includes('0 likes'));
  check('a region with an inline <template> loads itself', true);
  await p.click('text=Like it');
  await until(p, () => document.querySelector('#likes').textContent.includes('1 like'));
  check('a button inside the region redraws it', true);
  await p.click('text=Break the server');
  await until(p, () => document.querySelector('#error').textContent.includes('on purpose'));
  check('jx:error carries the server\'s message', true);
  await p.click('text=Like it');
  await until(p, () => document.querySelector('#likes').textContent.includes('2 likes') && !document.querySelector('#error').textContent);
  check('jx:afterRender clears the error', true);

  await p.type('input[name=q]', 'gr');
  await until(p, () => document.querySelector('#results').textContent.includes('Grace'));
  check('live search with jx-target and jx-each', await p.locator('#results li').count() === 1);
  check('class:pioneer toggles a class', await p.locator('#results li.pioneer').count() === 1);
  await p.fill('input[name=q]', 'zzz');
  await until(p, () => document.querySelector('#results').textContent.includes('No one matches "zzz"'));
  check('jx-if="!users" shows the empty message', true);

  await p.locator('star-rating button[data-value="4"]').click();
  await until(p, () => document.querySelector('#feedback').textContent.includes('4 stars'));
  check('custom event + component value', true);
  await p.click('text=Refresh stats');
  await until(p, () => document.querySelector('#stats').shadowRoot.textContent.includes('of 5 done'));
  check('prop: swap into a component', true);
  await p.locator('user-card').nth(1).locator('button').click();
  await until(p, () => document.querySelectorAll('user-card')[1].shadowRoot.querySelector('#body').textContent.includes('Grace Hopper'));
  check('jsonx inside shadow DOM, with the component\'s own template', true);
  check('no page errors', p.errors.length === 0);
  if (p.errors.length) console.log(p.errors);
}

async function todoExample(browser, base, folder) {
  console.log('\n# examples/' + folder + ' (Web Awesome)');
  const p = await newPage(browser);
  await p.goto(base + '/examples/' + folder + '/');
  const items = '#app .todos li:not(.empty)';
  const count = (n) => until(p, ([sel, n]) => document.querySelectorAll(sel).length === n, [items, n]);
  const statsSay = (text) => until(p, (text) => document.querySelector('#app').innerText.includes(text), text);
  const filterButton = (name) => p.locator('#app wa-button-group wa-button', { hasText: name });

  await count(3);
  await statsSay('1 of 3 done');
  check('loads the whole view: 3 todos and stats', true);

  await p.locator('wa-input[name=title] input').fill('Buy milk');
  await p.locator('wa-button[variant=brand]', { hasText: 'Add' }).click();
  await count(4);
  check('Add button sends the title from the region', (await p.locator(items).nth(3).innerText()).includes('Buy milk'));
  await statsSay('1 of 4 done');
  check('stats come back in the same response', true);
  check('input is empty after adding', !(await p.evaluate(() => document.querySelector('wa-input[name=title]').value)));

  await p.locator('wa-input[name=title] input').fill('Walk the dog');
  await p.locator('wa-input[name=title] input').press('Enter');
  await count(5);
  check('Enter in the input adds a todo (keydown[key=Enter])', true);
  await until(p, () => document.activeElement && document.activeElement.matches('wa-input[name=title]'));
  check('input keeps focus after re-render (autofocus)', true);

  await p.evaluate(() => { window.firstRow = document.querySelector('#app .todos li:not(.empty) wa-checkbox'); });
  await p.locator('wa-input[name=title] input').fill('Half-typ');
  await p.locator(items).nth(3).locator('wa-checkbox').click();
  await statsSay('2 of 5 done');
  check('<wa-checkbox> toggles a todo', await p.locator('#app .todos li.done').count() === 2);
  check('unchanged components are kept (same element)', await p.evaluate(() => window.firstRow === document.querySelector('#app .todos li:not(.empty) wa-checkbox')));
  check('half-typed text is kept (echoed back as draft)', await p.evaluate(() => document.querySelector('wa-input[name=title]').value === 'Half-typ'));
  await p.locator('wa-input[name=title] input').fill('');

  await filterButton('Done').click();
  await count(2);
  check('filter: done', true);
  await p.locator(items).nth(0).locator('wa-checkbox').click();
  await count(1);
  check('the filter is remembered by later requests (hidden input)', true);
  await filterButton('Active').click();
  await until(p, (sel) => document.querySelectorAll(sel).length === 4 && !document.querySelector('#app .todos li.done'), items);
  check('filter: active', true);
  await filterButton('All').click();
  await count(5);

  await p.locator(items).nth(0).locator('wa-button').click();
  await count(4);
  await statsSay('of 4 done');
  check('deletes a todo', true);

  await p.locator('#app wa-button', { hasText: 'Clear completed' }).click();
  await statsSay('0 of 3 done');
  check('clear completed', true);

  await p.locator('wa-button[variant=brand]', { hasText: 'Add' }).click();
  await statsSay('Title is required');
  check('an empty todo shows the error from the view', true);

  await p.reload();
  await count(3);
  check('todos survive a reload (localStorage)', true);
  if (folder === 'todo') {
    const results = await p.evaluate(() => {
      const make = (id, html) => {
        const node = document.createElement('template');
        node.id = id; node.innerHTML = html;
        document.body.append(node);
      };
      make('xss', '<p class="{{cls}}" title="x {{cls}}">{{text}}</p>');
      make('rules', '<b jx-if="!items">none</b><i jx-each="items" class:on="{{on}}">{{name}}</i><textarea name="t">{{body}}</textarea>');
      const host = document.createElement('div');
      host.setAttribute('jx-template', '#xss');
      document.body.append(host);
      jsonx.render(host, { cls: '"><img src=x onerror=alert(1)>', text: '<b>hi</b>' });
      const escaped = !host.querySelector('img') && !host.querySelector('b') && host.textContent.trim() === '<b>hi</b>';

      const host2 = document.createElement('div');
      host2.setAttribute('jx-template', '#rules');
      document.body.append(host2);
      jsonx.render(host2, { items: [], body: 'hello' });
      const empty = host2.querySelectorAll('b').length === 1 && host2.querySelectorAll('i').length === 0;
      jsonx.render(host2, { items: [{ id: 1, name: 'a', on: true }, { id: 2, name: 'b', on: false }], body: 'hello' });
      const list = host2.querySelectorAll('b').length === 0 &&
        Array.from(host2.querySelectorAll('i')).map((i) => i.textContent + i.className).join(',') === 'aon,b';
      const textarea = host2.querySelector('textarea').value === 'hello';
      return { escaped, empty, list, textarea };
    });
    check('values are escaped, not run as HTML', results.escaped);
    check('jx-if="!items" shows only for an empty list', results.empty);
    check('jx-each repeats, class:on toggles a class', results.list);
    check('{{x}} inside a <textarea> sets its value', results.textarea);
  }
  if (process.env.SCREENSHOT) await p.screenshot({ path: process.env.SCREENSHOT, fullPage: true });
  check('no page errors', p.errors.length === 0);
  if (p.errors.length) console.log(p.errors);
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    await basicExample(browser, server.url);
    await todoExample(browser, server.url, 'todo');
  } catch (e) {
    console.log('FAIL', e.message);
    failures++;
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})();
