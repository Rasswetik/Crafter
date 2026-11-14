/* The name of the currency in every text of the site. The texts are written with the word «шары»; when the administrator chooses another currency
   (points, coins or an own one) the words are replaced in everything that appears on the page, the panels of the administrator included. */
(function () {
'use strict';
const c = window.crafterCurrency;
if (!c || c.kind === 'balls' || !c.name) return;
const name = String(c.name), gen = String(c.gen || c.name.toLowerCase());
const up = s => s.charAt(0).toUpperCase() + s.slice(1), low = s => s.charAt(0).toLowerCase() + s.slice(1);
const RE = /(новогодн(?:ие|их|ими)\s+)?(?<![А-Яа-яЁё])([Шш])ар(ы|ов)(?![А-Яа-яЁё])(?!\s+и\s+звёзд)/gi;
const IN = /(\S+)\s+в\s+шарах(?![А-Яа-яЁё])/gi;                                       // «Цена в шарах» can not be declined for an own name: «Цена, коинов»
const fix = s => !s || !/ар(?:ы|ов|ах)/i.test(s) ? s : s.replace(IN, (m, w) => w + ', ' + gen).replace(RE, (m, pre, first, end) => {
    const word = String(end).toLowerCase() === 'ы' ? name : gen;
    const capital = pre ? /[А-ЯЁ]/.test(pre.charAt(0)) : /[А-ЯЁ]/.test(first);
    return capital ? up(word) : low(word);
});
const SKIP = {SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, NOSCRIPT: 1};
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { const t = fix(root.nodeValue); if (t !== root.nodeValue) root.nodeValue = t; return; }
    if (root.nodeType !== 1 || SKIP[root.tagName]) return;
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {acceptNode: n => n.parentNode && SKIP[n.parentNode.tagName] ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT});
    let n; while ((n = tw.nextNode())) { const t = fix(n.nodeValue); if (t !== n.nodeValue) n.nodeValue = t; }
    const els = root.matches && root.matches('[placeholder],[title],[aria-label]') ? [root] : [];
    root.querySelectorAll && root.querySelectorAll('[placeholder],[title],[aria-label]').forEach(x => els.push(x));
    els.forEach(x => ATTRS.forEach(a => { const v = x.getAttribute(a); if (v) { const t = fix(v); if (t !== v) x.setAttribute(a, t); } }));
}
let queue = [], timer = 0;
const flush = () => { timer = 0; const list = queue; queue = []; list.forEach(walk); };
new MutationObserver(list => {
    list.forEach(m => { if (m.type === 'childList') m.addedNodes.forEach(n => queue.push(n)); else if (m.type === 'characterData') queue.push(m.target); });
    if (!timer) timer = setTimeout(flush, 16);
}).observe(document.documentElement, {childList: true, subtree: true, characterData: true});
const start = () => { walk(document.body); document.title = fix(document.title); };
if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
