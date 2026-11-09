const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const {app,POSTS} = require('../server');
const output=path.resolve(process.env.RESULT_DIR || 'test-results'); fs.mkdirSync(output,{recursive:true});
const results=[];
async function check(name,fn){const t=performance.now(); await fn(); results.push({name,result:'PASS',elapsedMs:+(performance.now()-t).toFixed(2)}); console.log('PASS',name);}
const server=app.listen(0,'127.0.0.1',async()=>{
 let browser;
 try {
 const base=`http://127.0.0.1:${server.address().port}`;
 const api=async route=>{const r=await fetch(base+route); assert.equal(r.status,200); return r.json()};
 const all=[];for(let page=1;page<=10;page++) all.push(...(await api(`/api/posts?limit=100&page=${page}`)).items);
 await check('offset: 1,000 unique IDs, meta and page 2',async()=>{assert.equal(new Set(all.map(p=>p.id)).size,1000);const j=await api('/api/posts?page=2'); assert.equal(j.items[0].id,990);assert.deepEqual([j.meta.page,j.meta.totalCount,j.meta.totalPages,j.meta.hasNext,j.meta.hasPrev],[2,1000,100,true,true]);});
 await check('title/body/no-result search',async()=>{for(const term of ['B-Tree','상세 본문','NO_MATCH_987']){const j=await api('/api/posts?limit=100&search='+encodeURIComponent(term));const expected=all.filter(p=>(p.title+p.content).toLowerCase().includes(term.toLowerCase()));assert.equal(j.meta.totalCount,expected.length);if(!expected.length)assert.deepEqual([j.items.length,j.meta.totalPages,j.meta.hasNext],[0,1,false]);}});
 await check('latest/oldest/views and guaranteed view tie id DESC',async()=>{
  const a=POSTS[0].views,b=POSTS[1].views;POSTS[0].views=99999;POSTS[1].views=99999;
  try{for(const sort of ['latest','oldest','views']){const j=await api('/api/posts?sort='+sort);const cmp=sort==='views'?(a,b)=>b.views-a.views||b.id-a.id:sort==='oldest'?(a,b)=>a.id-b.id:(a,b)=>b.id-a.id;assert.deepEqual(j.items,POSTS.slice().sort(cmp).slice(0,10));}assert.deepEqual((await api('/api/posts?sort=views')).items.slice(0,2).map(p=>p.id),[1000,999]);}finally{POSTS[0].views=a;POSTS[1].views=b;}
 });
 await check('sort whitelist: invalid, __proto__, constructor, toString',async()=>{for(const sort of ['invalid','__proto__','constructor','toString']){const j=await api('/api/posts?sort='+sort);assert.equal(j.meta.sort,'latest');assert.equal(j.items[0].id,1000);}});
 await check('page 0/-1/abc, limit 1000, excessive page, malformed query',async()=>{for(const page of ['0','-1','abc','2abc']) assert.equal((await api('/api/posts?page='+page)).meta.page,1);assert.equal((await api('/api/posts?limit=1000')).meta.limit,100);assert.equal((await api('/api/posts?page=9999')).meta.page,100);assert.equal((await api('/api/posts?search=x&search=y&sort=views&sort=oldest')).meta.sort,'latest');});
 await check('cursor search to end: exact match, zero duplicates/omissions',async()=>{for(const search of ['','B-Tree','상세 본문','NO_MATCH_987']){let cursor=null,ids=[],j;do{j=await api('/api/posts/cursor?limit=50&search='+encodeURIComponent(search)+(cursor?'&cursor='+cursor:''));ids.push(...j.items.map(p=>p.id));cursor=j.meta.nextCursor;assert.ok(ids.length<=1000);}while(j.meta.hasNext);const expected=all.filter(p=>(p.title+p.content).toLowerCase().includes(search.toLowerCase())).map(p=>p.id);assert.deepEqual(ids,expected);assert.equal(new Set(ids).size,ids.length);}});
 await check('cursor limit+1 boundaries: exactly limit / limit+1 / empty',async()=>{for(const [cursor,expected,hasNext] of [[11,10,false],[12,10,true],[1,0,false]]){const j=await api(`/api/posts/cursor?cursor=${cursor}&limit=10&search=상세`);assert.equal(j.items.length,expected);assert.equal(j.meta.hasNext,hasNext);}});
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 const page=await browser.newPage({viewport:{width:1600,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const settled=()=>page.waitForFunction(()=>document.querySelector('#inspectJson').textContent.includes('"executionTimeMs"'));
 const waitMeta=predicate=>page.waitForFunction(predicate);
 await page.goto(base);await settled();
 await check('300ms debounce: 100ms typing interval -> one HTTP request',async()=>{const req=[];const listener=r=>{if(r.url().includes('/api/posts'))req.push(r.url())};page.on('request',listener);await page.locator('#searchInput').pressSequentially('Redis',{delay:100});await waitMeta(()=>JSON.parse(document.querySelector('#inspectJson').textContent).items[0]?.title.includes('Redis'));page.off('request',listener);assert.equal(req.length,1);await page.screenshot({path:path.join(output,'01-debounce.png'),fullPage:true});});
 await check('search/sort reset page and URL, refresh + back restore',async()=>{
  await page.goto(base+'/?page=3&limit=10&sort=oldest&search=상세');await waitMeta(()=>JSON.parse(document.querySelector('#inspectJson').textContent).meta?.page===3);
  await page.selectOption('#sortSelect','views');await waitMeta(()=>JSON.parse(document.querySelector('#inspectJson').textContent).meta?.sort==='views');assert.equal(new URL(page.url()).searchParams.get('page'),'1');
  await page.reload();await waitMeta(()=>JSON.parse(document.querySelector('#inspectJson').textContent).meta?.sort==='views');assert.equal(await page.inputValue('#searchInput'),'상세');assert.equal(await page.inputValue('#sortSelect'),'views');
  await page.goBack();await waitMeta(()=>JSON.parse(document.querySelector('#inspectJson').textContent).meta?.page===3);assert.equal(await page.inputValue('#sortSelect'),'oldest');
  await page.fill('#searchInput','Redis');await waitMeta(()=>JSON.parse(document.querySelector('#inspectJson').textContent).items[0]?.title.includes('Redis'));assert.equal(new URL(page.url()).searchParams.get('page'),'1');
  await page.screenshot({path:path.join(output,'02-url.png'),fullPage:true});
 });
 await check('cursor UI: fixed sort, accumulation reset, exhausted button',async()=>{
  await page.click('#tabCursor');await page.waitForTimeout(200);assert.equal(await page.isDisabled('#sortSelect'),true);
  await page.fill('#searchInput','[#1000]');await waitMeta(()=>JSON.parse(document.querySelector('#inspectJson').textContent).items[0]?.id===1000 && JSON.parse(document.querySelector('#inspectJson').textContent).items.length===1);assert.equal(await page.isDisabled('#btnMore'),true);assert.equal(await page.locator('#tableBody tr').count(),1);
  const newSearch=page.waitForResponse(r=>new URL(r.url()).searchParams.get('search')==='B-Tree');
  await page.fill('#searchInput','B-Tree');await newSearch;await page.waitForFunction(()=>document.querySelectorAll('#tableBody tr').length===10);
  while(!(await page.isDisabled('#btnMore'))){const count=await page.locator('#tableBody tr').count();await page.click('#btnMore');await page.waitForFunction(n=>document.querySelectorAll('#tableBody tr').length>n,count);}
  const ids=await page.locator('#tableBody tr td:first-child').allTextContents();assert.deepEqual(ids.map(Number),all.filter(p=>p.title.includes('B-Tree')).map(p=>p.id));
  await page.screenshot({path:path.join(output,'03-cursor-complete.png'),fullPage:true});
  await page.fill('#searchInput','NO_MATCH_987');await waitMeta(()=>JSON.parse(document.querySelector('#inspectJson').textContent).items.length===0);assert.match(await page.innerText('#tableBody'),/일치하는 글이 없습니다/);assert.equal(await page.isDisabled('#btnMore'),true);
  await page.screenshot({path:path.join(output,'03-cursor-empty.png'),fullPage:true});
 });
 await check('slow response cancellation / final result / safe AbortError',async()=>{
  await page.click('#tabOffset');await page.waitForTimeout(150);await page.fill('#searchInput','');await page.waitForTimeout(400);
  let aborted=0;page.on('requestfailed',r=>{if(r.url().includes('/api/posts'))aborted++});
  await page.route('**/api/posts?*',async route=>{const response=await route.fetch();if(new URL(route.request().url()).searchParams.get('search')==='Redis')await new Promise(r=>setTimeout(r,1200));try{await route.fulfill({response});}catch{}});
  await page.fill('#searchInput','Redis');await page.waitForTimeout(400);await page.fill('#searchInput','B-Tree');await waitMeta(()=>JSON.parse(document.querySelector('#inspectJson').textContent).items[0]?.title.includes('B-Tree'));await page.waitForTimeout(1300);assert.match(await page.innerText('#tableBody'),/B-Tree/);assert.ok(aborted>=1);assert.equal(errors.length,0);await page.screenshot({path:path.join(output,'04-cancellation.png'),fullPage:true});await page.unroute('**/api/posts?*');
 });
 await check('invalid URL canonicalized; popstate leaves cursor mode',async()=>{await page.goto(base+'/?page=-1&limit=1000&sort=__proto__');await settled();const q=new URL(page.url()).searchParams;assert.equal(q.get('page'),'1');assert.equal(q.get('limit'),'100');assert.equal(q.get('sort'),'latest');await page.selectOption('#sortSelect','oldest');await page.waitForTimeout(150);await page.click('#tabCursor');await page.waitForTimeout(150);await page.goBack();await waitMeta(()=>!document.querySelector('#sortSelect').disabled);assert.equal(await page.inputValue('#sortSelect'),'latest');});
 await check('stale response guard even when fetch ignores AbortSignal',async()=>{
  await page.evaluate(()=>{window.realFetch=window.fetch;window.fetch=(url,options)=>window.realFetch(url,{}).then(response=>new URL(url,location.origin).searchParams.get('search')==='Redis'?new Promise(resolve=>setTimeout(()=>resolve(response),1200)):response);});
  await page.fill('#searchInput','Redis');await page.waitForTimeout(400);await page.fill('#searchInput','B-Tree');await waitMeta(()=>JSON.parse(document.querySelector('#inspectJson').textContent).items[0]?.title.includes('B-Tree'));await page.waitForTimeout(1300);assert.match(await page.innerText('#tableBody'),/B-Tree/);await page.evaluate(()=>window.fetch=window.realFetch);
 });
 console.log(`${results.length} checks passed`);
 } catch(error) {results.push({result:'FAIL',error:error.stack}); console.error(error);process.exitCode=1;}
 finally {fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({testedAt:new Date().toISOString(),results},null,2));await browser?.close();server.close();}
});
