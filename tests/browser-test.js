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
  const items = '#list li:not(.empty)';
  const stats = () => p.locator('#stats').innerText();

  await until(p, (sel) => document.querySelectorAll(sel).length === 3, items);
  check('loads 3 todos', true);
  await until(p, () => document.querySelector('#stats').innerText.includes('1 of 3 done'));
  check('stats load', true);

  await p.locator('wa-input[name=title] input').fill('Buy milk');
  await p.locator('wa-button[type=submit]').click();
  await until(p, (sel) => document.querySelectorAll(sel).length === 4, items);
  check('adds a todo via <wa-input> + <wa-button type=submit>', (await p.locator(items).nth(3).innerText()).includes('Buy milk'));
  await until(p, () => !document.querySelector('wa-input[name=title]').value);
  check('input is cleared after adding', true);
  await until(p, () => document.querySelector('#stats').innerText.includes('1 of 4 done'));
  check('stats refresh after adding', true);

  await p.locator(items).nth(3).locator('wa-checkbox').click();
  await until(p, () => document.querySelectorAll('#list li.done').length === 2);
  check('<wa-checkbox> change toggles a todo', true);
  await until(p, () => document.querySelector('#stats').innerText.includes('2 of 4 done'));
  check('stats refresh after toggling (row was replaced)', true);

  await p.locator('wa-radio[value=done]').click();
  await until(p, (sel) => document.querySelectorAll(sel).length === 2, items);
  check('<wa-radio-group> filter: done', true);
  await p.locator('wa-radio[value=active]').click();
  await until(p, (sel) => document.querySelectorAll(sel).length === 2 && !document.querySelector('#list li.done'), items);
  check('<wa-radio-group> filter: active', true);
  await p.locator('wa-radio[value=all]').click();
  await until(p, (sel) => document.querySelectorAll(sel).length === 4, items);

  await p.locator(items).nth(0).locator('wa-button').click();
  await until(p, (sel) => document.querySelectorAll(sel).length === 3, items);
  await until(p, () => document.querySelector('#stats').innerText.includes('of 3 done'));
  check('deletes a todo, stats follow', true);

  await p.locator('#clear').click();
  await until(p, () => document.querySelector('#stats').innerText.includes('0 of 2 done'));
  await until(p, (sel) => document.querySelectorAll(sel).length === 2, items);
  check('clear completed', true);

  await p.locator('wa-button[type=submit]').click();
  await until(p, () => !document.querySelector('#error').hidden && document.querySelector('#error').textContent.includes('Title is required'));
  check('empty todo shows the server error', true);

  await p.reload();
  await until(p, (sel) => document.querySelectorAll(sel).length === 2, items);
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
