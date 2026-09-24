import { useMemo, useState, type ReactNode } from 'react';
import { Activity, ArrowDown, ArrowUp, Bell, Clock3, Flame, Newspaper, Search, TrendingUp, Wifi } from 'lucide-react';
import type { NewsArticle } from '../types/news';
import type { ScannerStatus, StockData } from '../types/scanner';
import { StockDetailDrawer } from './StockDetailDrawer';
import './MultiScannerDashboard.css';

type Props = { stocks: StockData[]; status: ScannerStatus; newsArticles: NewsArticle[]; newsStatus: any; ukTime: string; etTime: string; };
const money=(n:number)=>n>0?'$'+(n<1?n.toFixed(4):n.toFixed(2)):'—';
const pct=(n:number|null|undefined)=>n==null||!Number.isFinite(n)?'—':(n>=0?'+':'')+n.toFixed(2)+'%';
const vol=(n:number)=>n>=1000000?(n/1000000).toFixed(1)+'M':n>=1000?(n/1000).toFixed(0)+'K':String(Math.round(n));
const positive=(n:number|null|undefined)=>n!=null&&n>0;
const shortMomo=(s:StockData)=>s.twoMinuteChange??((s.oneMinuteChange??0)*0.6+(s.fiveMinuteChange??0)*0.4);
const hasHigh=(s:StockData)=>s.distanceFromHigh!=null&&s.distanceFromHigh<=0.01;
const gapPct=(s:StockData)=>s.dayOpen!=null&&s.previousClose!=null&&s.previousClose>0?((s.dayOpen-s.previousClose)/s.previousClose)*100:null;

export function MultiScannerDashboard({stocks,status,newsArticles,ukTime,etTime}:Props){
  const [selected,setSelected]=useState<string|null>(null);
  const [panel,setPanel]=useState<'all'|'up'|'down'|'gap'|'high'|'news'>('all');
  const [query,setQuery]=useState('');
  const visible=useMemo(()=>{const q=query.trim().toUpperCase();return stocks.filter(s=>!q||s.symbol.includes(q)||(s.name||'').toUpperCase().includes(q));},[stocks,query]);
  const momo=useMemo(()=>[...visible].filter(s=>s.distanceFromHigh!=null&&s.distanceFromHigh<=0.02).sort((a,b)=>shortMomo(b)-shortMomo(a)||b.score-a.score).slice(0,12),[visible]);
  const up=useMemo(()=>momo.filter(s=>shortMomo(s)>0).slice(0,8),[momo]);
  const down=useMemo(()=>[...visible].filter(s=>shortMomo(s)<0).sort((a,b)=>shortMomo(a)-shortMomo(b)).slice(0,8),[visible]);
  const gaps=useMemo(()=>[...visible].filter(s=>(gapPct(s)??-999)>0).sort((a,b)=>(gapPct(b)??-999)-(gapPct(a)??-999)).slice(0,8),[visible]);
  const highs=useMemo(()=>[...visible].filter(hasHigh).sort((a,b)=>(b.oneMinuteChange??-999)-(a.oneMinuteChange??-999)).slice(0,8),[visible]);
  const stale=useMemo(()=>[...visible].filter(s=>s.halted||s.freshness==='STALE').slice(0,8),[visible]);
  const news=useMemo(()=>newsArticles.slice(0,12),[newsArticles]);
  const active=selected?stocks.find(s=>s.symbol===selected)||null:null;
  const activeNews=selected?newsArticles.filter(a=>a.symbols?.some(x=>x.toUpperCase()===selected.toUpperCase())):[];

  const row=(s:StockData, i:number, mode='momo')=>(
    <button className="ms-row" key={s.symbol} onClick={()=>setSelected(s.symbol)}>
      <span className="ms-rank">{i+1}</span><span className="ms-symbol">{s.symbol}<small>{s.name||'US equity'}</small></span>
      <span>{money(s.price)}</span><span className={positive(mode==='gap'?gapPct(s):s.dailyChange)?'up':'down'}>{pct(mode==='gap'?gapPct(s):s.dailyChange)}</span>
      <span className={positive(s.oneMinuteChange)?'up':s.oneMinuteChange!=null?'down':''}>{pct(s.oneMinuteChange)}</span>
      <span className={positive(s.fiveMinuteChange)?'up':s.fiveMinuteChange!=null?'down':''}>{pct(s.fiveMinuteChange)}</span>
      <span>{s.relativeVolume?s.relativeVolume.toFixed(2)+'x':'—'}</span><span>{mode==='high'?pct(s.distanceFromHigh):s.score}</span>
    </button>
  );

  const list = panel==='up'?up:panel==='down'?down:panel==='gap'?gaps:panel==='high'?highs:momo;
  const title = panel==='all'?'Momo HOD':panel==='up'?'2 min. Momo UP':panel==='down'?'2 min. Momo DOWN':panel==='gap'?'Gap Up':panel==='high'?'New High Scanner':'Live News';

  return <div className="ms-shell">
    <header className="ms-header">
      <div className="ms-brand"><span>JF</span><div><strong>JFIRE MOMENTUM</strong><small>LIVE US EQUITY SCANNER</small></div></div>
      <div className="ms-clocks"><div><Clock3 size={13}/><small>UK</small><b>{ukTime.replace(' UK','')}</b></div><div><Clock3 size={13}/><small>NEW YORK</small><b>{etTime.replace(' ET','')}</b></div></div>
      <div className="ms-live"><i/> {status.connected?'LIVE':'REST'} <small>{(status.activeFeed||status.feed||'IEX').toUpperCase()} · {status.stocksTracked.toLocaleString()} tracked</small></div>
    </header>
    <div className="ms-toolbar">
      <div><Flame size={16}/><strong>MOMO HOD</strong><span>Short-term movement · HOD · volume · real market data</span></div>
      <label><Search size={13}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search ticker / company"/></label>
      <button className={panel==='all'?'sel':''} onClick={()=>setPanel('all')}><Activity size={13}/>Momo HOD</button>
      <button className={panel==='up'?'sel':''} onClick={()=>setPanel('up')}><ArrowUp size={13}/>Momo UP</button>
      <button className={panel==='down'?'sel':''} onClick={()=>setPanel('down')}><ArrowDown size={13}/>Momo DOWN</button>
      <button className={panel==='gap'?'sel':''} onClick={()=>setPanel('gap')}><TrendingUp size={13}/>Gap Up</button>
      <button className={panel==='high'?'sel':''} onClick={()=>setPanel('high')}><Bell size={13}/>New High</button>
      <button className={panel==='news'?'sel':''} onClick={()=>setPanel('news')}><Newspaper size={13}/>News</button>
    </div>
    <div className="ms-grid">
      <section className="ms-panel ms-main">
        <PanelHead title={title} count={panel==='news'?news.length:list.length}/>
        {panel==='news'?<NewsList articles={news} onSelect={setSelected}/>:<><TableHead mode={panel}/>{list.map((s,i)=>row(s,i,panel))}</>}
      </section>
      <section className="ms-panel ms-news"><PanelHead title="LIVE NEWS" count={news.length}/><NewsList articles={news.slice(0,9)} onSelect={setSelected}/></section>
      <aside className="ms-side">
        <section className="ms-panel"><PanelHead title="2 min. MOMO UP" icon={<ArrowUp size={13}/>} count={up.length}/><MiniList items={up} up onSelect={setSelected}/></section>
        <section className="ms-panel"><PanelHead title="2 min. MOMO DOWN" icon={<ArrowDown size={13}/>} count={down.length}/><MiniList items={down} onSelect={setSelected}/></section>
        <section className="ms-panel"><PanelHead title="NEW HIGH SCANNER" icon={<Bell size={13}/>} count={highs.length}/><MiniList items={highs} high onSelect={setSelected}/></section>
        <section className="ms-panel"><PanelHead title="HALT / STALE WATCH" icon={<Wifi size={13}/>} count={stale.length}/><MiniList items={stale} stale onSelect={setSelected}/></section>
      </aside>
      <section className="ms-chart">
        <div className="chart-top"><div><strong>{active?.symbol||momo[0]?.symbol||'—'}</strong><span>{active?.name||'Select a scanner row to focus the stock'}</span></div><div>{active?money(active.price):'—'} <em className={positive(active?.dailyChange)?'up':'down'}>{active?pct(active.dailyChange):'—'}</em></div></div>
        <div className="fake-chart">{active?<><div className="chart-watermark">{active.symbol}</div><div className="chart-line">{Array.from({length:48},(_,i)=><i key={i} style={{height:(18+Math.abs(Math.sin(i/4))*45+(i>38?(i-38)*2:0))+'%'}}/>)}</div><div className="chart-axis"><span>5M {pct(active.fiveMinuteChange)}</span><span>1M {pct(active.oneMinuteChange)}</span><span>HOD {money(active.dayHigh)}</span><span>RVOL {active.relativeVolume?active.relativeVolume.toFixed(2)+'x':'—'}</span></div></>:<div className="chart-empty">Click a stock above to focus it.</div>}</div>
      </section>
      <section className="ms-panel ms-gap"><PanelHead title="GAP UP / RUNNERS" icon={<TrendingUp size={13}/>} count={gaps.length}/><MiniList items={gaps} gap onSelect={setSelected}/></section>
    </div>
    <footer className="ms-footer"><span>REAL MARKET DATA ONLY</span><span>{status.universeSize.toLocaleString()} common stocks · {status.stocksTracked.toLocaleString()} tracked · {status.monitoredSymbols.toLocaleString()} live symbols</span><span>Last feed: {status.diagnostics?.wsLastMessageTime?new Date(status.diagnostics.wsLastMessageTime).toLocaleTimeString('en-GB',{hour12:false}):'—'}</span></footer>
    <StockDetailDrawer symbol={selected} onClose={()=>setSelected(null)} stock={active} newsArticles={activeNews} getSignalClass={()=>'signal-building'} getFreshnessConfig={(f)=>({label:f||'LIVE',icon:'●',className:'freshness-live',title:'Live data'})} getTriggerClass={()=>''}/>
  </div>;
}
function PanelHead({title,count,icon}:{title:string;count:number;icon?:ReactNode}){return <div className="ms-panel-head"><div>{icon||<Activity size={13}/>}<strong>{title}</strong></div><span>{count}</span></div>}
function TableHead({mode}:{mode:string}){return <div className="ms-table-head"><span>#</span><span>NAME</span><span>PRICE</span><span>DAY</span><span>1M</span><span>2M</span><span>5M</span><span>RVOL</span><span>{mode==='high'?'HOD':'SCORE'}</span></div>}
function MiniList({items,up,high,stale,gap,onSelect}:{items:StockData[];up?:boolean;high?:boolean;stale?:boolean;gap?:boolean;onSelect:(s:string)=>void}){return <div className="mini-list">{items.map(s=><button key={s.symbol} onClick={()=>onSelect(s.symbol)}><b>{s.symbol}</b><span>{money(s.price)}</span><em className={up?'up':stale?'muted':(s.twoMinuteChange??s.oneMinuteChange??0)<0?'down':'up'}>{high?'NEW HIGH':s.halted?'HALTED':stale?'NO RECENT TICK':pct(gap?gapPct(s):s.twoMinuteChange)}</em><small>{vol(s.volume)} · {s.relativeVolume?s.relativeVolume.toFixed(1)+'x RVOL':'RVOL —'}</small></button>)}</div>}
function NewsList({articles,onSelect}:{articles:NewsArticle[];onSelect:(s:string)=>void}){return <div className="news-list">{articles.map(a=><button key={a.id} onClick={()=>a.symbols?.[0]&&onSelect(a.symbols[0])}><time>{new Date(a.createdAt||Date.now()).toLocaleTimeString('en-GB',{hour12:false,hour:'2-digit',minute:'2-digit'})}</time><strong>{a.symbols?.slice(0,2).join(', ')||'MARKET'}</strong><span>{a.headline}</span></button>)}</div>}