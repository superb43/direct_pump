type Task=(slot:number,signal:AbortSignal)=>Promise<void>;
type Job={task:Task;slot:number;due:number;started:number;dirty:boolean;running:boolean;abort?:AbortController};

/** Fixed coalescing window, one start/3s per binding, two quotes across all views. */
export function createPriceScheduler(){
  const jobs=new Map<string,Job>(),lastStarted=new Map<string,number>();let active=0,timer:ReturnType<typeof setTimeout>|undefined;
  function pump(){
    if(timer!==undefined)clearTimeout(timer);timer=undefined;
    while(active<2){
      const next=[...jobs.values()].filter(job=>job.dirty&&!job.running).sort((a,b)=>a.due-b.due)[0];
      if(!next)break;
      if(next.due>Date.now()){timer=setTimeout(pump,next.due-Date.now());break;}
      next.dirty=false;next.running=true;next.started=Date.now();next.abort=new AbortController();active++;
      for(const [key,job]of jobs)if(job===next)lastStarted.set(key,next.started);
      const task=next.task,slot=next.slot;next.slot=0;
      void Promise.resolve().then(()=>task(slot,next.abort!.signal)).catch(()=>{}).finally(()=>{
        active--;next.running=false;next.abort=undefined;
        if(!next.dirty)for(const [key,job]of jobs)if(job===next)jobs.delete(key);
        pump();
      });
    }
  }
  function enqueue(key:string,task:Task,slot=0,notBefore=0){
    let job=jobs.get(key);
    if(!job){job={task,slot,due:Date.now()+200,started:lastStarted.get(key)??-Infinity,dirty:false,running:false};jobs.set(key,job);}
    job.task=task;job.slot=Math.max(job.slot,slot);
    if(!job.dirty)job.due=Math.max(Date.now()+200,job.started+3000);
    job.due=Math.max(job.due,notBefore);
    job.dirty=true;pump();
    for(const [key,at]of lastStarted)if(Date.now()-at>60_000)lastStarted.delete(key);
  }
  function cancel(matches:(key:string)=>boolean){for(const [key,job]of jobs)if(matches(key)){job.abort?.abort();jobs.delete(key);}pump();}
  return {enqueue,cancel};
}
