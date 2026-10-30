#!/usr/bin/env node
/**
 * npm run bookmarklet
 * Writes results/login-bookmarklet.html: a "RDC login" bookmarklet with every QA account in .env, for both sites.
 *   Vercel or a local dev server: on the home page (signed out) it opens Member Portal Sign In, fills the account, signs in.
 *   The original site: on wp-login.php it fills the WordPress form and signs in; on any other page it goes there first
 *   (click it again once the form shows).
 * It lists only the accounts the current site has (NEW_<ROLE> for Vercel, LEGACY_<ROLE> for the original). It holds no
 * password: after adding the bookmark, edit it and replace [PASSWORD] with QA_PASSWORD from .env (npm run ui > Settings).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, accountFor, originalAccountFor, config } from './config.js';
import { ROLE_INFO } from './roles.js';

// [role name, Vercel username, original-site username]; "" where that site has no account.
const accounts = ROLE_INFO.map(r => [r.name, accountFor(r.role)?.username || '', originalAccountFor(r.role)?.username || ''])
  .filter(([, n, o]) => n || o);
if (!accounts.length) { console.error('No NEW_<ROLE> or LEGACY_<ROLE> accounts in .env: run npm run accounts first.'); process.exit(1); }
const legacyHost = new URL(config.originalUrl).host;

// The link is the plain code after "javascript:" (only % is encoded, which the code never uses), so the bookmark reads as
// JavaScript and [PASSWORD] is easy to find and replace.
const code = `(async()=>{const P='[PASSWORD]';if(P==='['+'PASSWORD]'){alert('Edit this bookmark and put the password where it says PASSWORD in square brackets.');return;}
const wp=location.host===${JSON.stringify(legacyHost)}||/(^|\\.)rdc8ims\\.online$/.test(location.host);
if(wp&&!document.getElementById('loginform')){location.href=location.origin+'/wp-login.php';return;}
const A=${JSON.stringify(accounts)}.map(a=>[a[0],a[wp?2:1]]).filter(a=>a[1]);
const n=Number(prompt('Sign in as:\\n'+A.map((a,i)=>(i+1)+'. '+a[0]+' ('+a[1]+')').join('\\n'),'1'));const a=A[n-1];if(!a)return;
const set=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};
if(wp){set(document.getElementById('user_login'),a[1]);set(document.getElementById('user_pass'),P);const r=document.getElementById('rememberme');if(r)r.checked=true;
const go=document.getElementById('wp-submit');if(go)go.click();else document.getElementById('loginform').requestSubmit();return;}
const wait=ms=>new Promise(r=>setTimeout(r,ms));let u=document.querySelector('input[name=username]');
if(!u){const b=[...document.querySelectorAll('button,a')].find(e=>/Member Portal/i.test(e.textContent||''));if(!b){alert('Open the home page first (signed out).');return;}b.click();
for(let i=0;i<30&&!u;i++){await wait(100);u=document.querySelector('input[name=username]');}}
if(!u){alert('The sign-in form did not open. If you are signed in, sign out first.');return;}
set(u,a[1]);set(document.querySelector('input[name=password]'),P);u.form.requestSubmit();})();`;
const href = 'javascript:' + code.replace(/\n/g, '').replace(/%/g, '%25');

const out = path.join(ROOT, 'results', 'login-bookmarklet.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>RDC login bookmarklet</title>
<body style="font:16px system-ui;margin:40px;max-width:640px">
<h1>RDC login bookmarklet</h1>
<p>Drag this link to your bookmarks bar: <a href="${href.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" style="padding:6px 12px;background:#3949ab;color:#fff;border-radius:6px;text-decoration:none">RDC login</a></p>
<p><b>First:</b> right-click the bookmark &gt; Edit, and in its URL replace <code>[PASSWORD]</code> with the QA accounts' shared password:
<code>QA_PASSWORD</code> in rdc-tester's <code>.env</code> (or <code>npm run ui</code> &gt; Settings (.env) &gt; QA accounts).</p>
<ul>
<li><b>Vercel or a local dev server</b> (e.g. http://localhost:8080): open the home page signed out, click <b>RDC login</b>, type the account's number.</li>
<li><b>Original site</b> (${legacyHost}): click <b>RDC login</b> on any page. It opens the WordPress sign-in page; click it again there and type the number.</li>
</ul>
<p>Bookmark URL, to paste into a new bookmark instead of dragging:</p><textarea readonly style="width:100%;height:160px">${href.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</textarea>
<p>${accounts.filter(a => a[1]).length} Vercel accounts, ${accounts.filter(a => a[2]).length} original-site accounts.</p>
</body>`);
console.log(`Written to ${path.relative(ROOT, out)}: ${accounts.filter(a => a[1]).length} Vercel and ${accounts.filter(a => a[2]).length} original-site accounts.`);
