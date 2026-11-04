import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BackgroundField } from "./background-field";

export const metadata: Metadata = {
  title: "Seasonz",
  description: "Seasonz — sports prediction model: schedules, Elo ratings, injury impact, props, and parlays.",
  // Together with app/manifest.ts, this is what makes "Add to Home Screen"
  // (iOS) launch the app full-screen in its own window — no Safari address
  // bar or tab chrome — rather than just bookmarking the page.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Seasonz",
  },
};

// viewport-fit=cover is what makes env(safe-area-inset-bottom) resolve to a
// real value instead of 0 on phones with a home-indicator bar, so the fixed
// bottom tab bar (see app/(app)/bottom-nav.tsx) doesn't sit under it.
// theme-color tints the mobile browser chrome to match the app, so it reads
// less like a web page and more like an installed app.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#09090b",
};

// Tiny reporter that runs before anything else: tells the server the page
// arrived and, a few seconds later, what the browser actually shows (text,
// background, styles, errors). Used to diagnose blank screens on phones.
const REPORTER = `(function(){try{
var errs=[];function send(k,d){try{d=d||{};d.kind=k;d.href=location.href;var b=JSON.stringify(d);if(navigator.sendBeacon){navigator.sendBeacon('/api/client-log',new Blob([b],{type:'text/plain'}))}else{fetch('/api/client-log',{method:'POST',body:b,keepalive:true})}}catch(e){}}
window.addEventListener('error',function(e){errs.push(String(e.message||(e.target&&(e.target.src||e.target.href))||'error').slice(0,200))},true);
window.addEventListener('unhandledrejection',function(e){errs.push('rejection: '+String(e.reason).slice(0,200))});
send('boot',{w:innerWidth,h:innerHeight,dpr:devicePixelRatio,dark:matchMedia('(prefers-color-scheme: dark)').matches,motion:matchMedia('(prefers-reduced-motion: reduce)').matches});
setTimeout(function(){try{var b=document.body,cs=b?getComputedStyle(b):null,f=document.querySelector('form'),r=f?f.getBoundingClientRect():null,ss=[];for(var i=0;i<document.styleSheets.length;i++){var s=document.styleSheets[i];var n=-1;try{n=s.cssRules.length}catch(e){}ss.push((s.href||'inline').slice(-40)+':'+n)}
send('report',{errs:errs.slice(0,15),bg:cs&&cs.backgroundColor,color:cs&&cs.color,textLen:b?b.innerText.length:-1,text:b?b.innerText.slice(0,160):'',form:r?[Math.round(r.top),Math.round(r.width),Math.round(r.height)]:null,sheets:ss,ready:document.readyState,scrollH:document.documentElement.scrollHeight,next:!!window.next,sw:!!(navigator.serviceWorker&&navigator.serviceWorker.controller)})}catch(e){send('report-failed',{e:String(e)})}},4000);
}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <script dangerouslySetInnerHTML={{ __html: REPORTER }} />
      </head>
      <body className="min-h-full flex flex-col font-sans bg-[#09090b]">
        <BackgroundField />
        {children}
      </body>
    </html>
  );
}
