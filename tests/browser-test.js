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
  await p.waitForSelector('#todo-items li input');
  check('loads 3 todos', await p.locator('#todo-items li').count() === 3);
  await p.fill('input[name=title]', 'New <b>thing</b>');
  await p.click('form button');
  await until(p, () => document.querySelectorAll('#todo-items li').length === 4);
  check('adds a todo, with HTML escaped', (await p.locator('#todo-items li').nth(3).innerText()).includes('New <b>thing</b>'));
  await p.locator('#todo-items li').nth(3).locator('input').check();
  await until(p, () => document.querySelector('#todo-items li:nth-child(4)').classList.contains('done'));
  await p.locator('#todo-items li').nth(3).locator('input').uncheck();
  await until(p, () => !document.querySelector('#todo-items li:nth-child(4)').classList.contains('done'));
  check('toggles twice (swapped-in HTML is re-wired)', true);
  await p.locator('#todo-items li').nth(0).locator('button').click();
  await until(p, () => document.querySelectorAll('#todo-items li').length === 3);
  check('deletes a todo', true);
  await p.fill('input[name=title]', '   ');
  await p.evaluate(() => document.querySelector('form').requestSubmit());
  await until(p, () => document.querySelector('#todo-error').textContent.includes('Title is required'));
  check('shows jx:error', true);
  await p.type('input[name=q]', 'gr');
  await until(p, () => document.querySelector('#results').textContent.includes('Grace'));
  check('live search', await p.locator('#results li').count() === 1);
  await p.locator('star-rating button[data-value="4"]').click();
  await until(p, () => document.querySelector('#feedback').textContent.includes('4 stars'));
  check('custom event + component value', true);
  await p.click('text=Refresh stats');
  await until(p, () => document.querySelector('#stats').shadowRoot.textContent.includes('of 3 done'));
  check('prop: swap into a component', true);
  await p.locator('user-card').nth(1).locator('button').click();
  await until(p, () => document.querySelectorAll('user-card')[1].shadowRoot.querySelector('#body').textContent.includes('Grace Hopper'));
  check('jsonx inside shadow DOM', true);
  check('no page errors', p.errors.length === 0);
  if (p.errors.length) console.log(p.errors);
}

async function todoExample(browser, base) {
  console.log('\n# examples/todo (Web Awesome)');
  const p = await newPage(browser);
  await p.goto(base + '/examples/todo/');
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

  await p.locator(items).nth(3).locator('wa-checkbox').click();
  await statsSay('2 of 5 done');
  check('<wa-checkbox> toggles a todo', await p.locator('#app .todos li.done').count() === 2);

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
  if (process.env.SCREENSHOT) await p.screenshot({ path: process.env.SCREENSHOT, fullPage: true });
  check('no page errors', p.errors.length === 0);
  if (p.errors.length) console.log(p.errors);
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    await basicExample(browser, server.url);
    await todoExample(browser, server.url);
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
