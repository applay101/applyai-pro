import Parser from 'rss-parser';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GEMINI_API_KEY) throw new Error('Missing env secrets');
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const parser = new Parser({ timeout: 15000 });

const feeds = {
  scholarships: [
    ['OYA Opportunities','https://oyaop.com/feed/'],
    ['Scholarship Positions','https://scholarship-positions.com/feed/'],
    ['Opportunities Corners','https://opportunitiescorners.com/feed/'],
    ['Youth Opportunities','https://www.youthop.com/feed'],
    ['DAAD News','https://www.daad.de/en/feed/']
  ],
  jobs: [
    ['RemoteOK','https://remoteok.com/remote-jobs.rss'],
    ['WeWorkRemotely','https://weworkremotely.com/remote-jobs.rss'],
    ['Remotive','https://remotive.com/remote-jobs/feed'],
    ['Arbeitnow Germany','https://www.arbeitnow.com/api/job-board-api']
  ],
  research_funds: [
    ['Euraxess','https://euraxess.ec.europa.eu/jobs/rss.xml'],
    ['NIH Grants','https://grants.nih.gov/grants/guide/newsfeed/fundingopps.xml']
  ],
  universities: [
    ['Studyportals','https://www.mastersportal.com/rss.xml'],
    ['FindAMasters','https://www.findamasters.com/rss.xml']
  ]
};

const countriesFa = ['آلمان','هلند','دانمارک','اسپانیا','انگلیس','اتریش','ایتالیا','یونان','آمریکا','کانادا','ژاپن','استرالیا','اتحادیه اروپا'];
function inferCountry(text=''){
  const t=text.toLowerCase();
  const pairs=[['germany','آلمان'],['netherlands','هلند'],['denmark','دانمارک'],['spain','اسپانیا'],['united kingdom','انگلیس'],['uk','انگلیس'],['austria','اتریش'],['italy','ایتالیا'],['greece','یونان'],['united states','آمریکا'],['usa','آمریکا'],['canada','کانادا'],['japan','ژاپن'],['australia','استرالیا'],['europe','اتحادیه اروپا'],['eu','اتحادیه اروپا']];
  return pairs.find(([k])=>t.includes(k))?.[1] || 'بین‌المللی';
}
function clean(s=''){return s.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,1200)}
async function translate(title, desc){
  const prompt = `متن زیر را برای سایت فارسی ApplyAI کاملا روان و حرفه‌ای فارسی کن. خروجی فقط JSON معتبر بده: {"title_fa":"...","description_fa":"..."}\nTITLE: ${title}\nDESC: ${desc}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
  try{
    const r = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}]})});
    const data = await r.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.replace(/```json|```/g,'').trim();
    const j = JSON.parse(text);
    return {title_fa:j.title_fa||title, description_fa:j.description_fa||desc};
  }catch(e){ return {title_fa:title, description_fa:desc}; }
}
async function exists(table, url){
  const {data} = await supabase.from(table).select('id').eq('source_url', url).limit(1);
  return data?.length>0;
}
async function insertItem(table, base){
  if (!base.source_url || await exists(table, base.source_url)) return;
  const tr = await translate(base.title || base.name || '', base.description || '');
  let row = {...base, ...tr};
  if(table==='universities') row = {name: base.title || base.name, name_fa: tr.title_fa, country: base.country, city:'', degree_level:'', source_url:base.source_url};
  if(table==='research_funds') row = {title:base.title, title_fa:tr.title_fa, country:base.country, organization:base.source, amount:'', source_url:base.source_url};
  const {error}= await supabase.from(table).insert(row);
  if(error) console.error(table, error.message);
}
async function rssItems(source, url){
  try{
    if(url.includes('arbeitnow.com')){
      const res=await fetch(url); const js=await res.json();
      return (js.data||[]).slice(0,40).map(x=>({title:x.title, description:clean(x.description), link:x.url}));
    }
    const feed=await parser.parseURL(url);
    return (feed.items||[]).slice(0,40).map(x=>({title:x.title, description:clean(x.contentSnippet||x.content||x.summary||''), link:x.link}));
  }catch(e){ console.error('feed failed', source, e.message); return []; }
}
for (const [table, list] of Object.entries(feeds)){
  for (const [source,url] of list){
    const items = await rssItems(source,url);
    for (const it of items){
      const text = `${it.title} ${it.description}`;
      const country = inferCountry(text);
      await insertItem(table, {title:it.title, description:it.description, country, city:'', source, source_url:it.link, job_type:'', amount:'', deadline:''});
    }
  }
}
console.log('ApplyAI import finished');
