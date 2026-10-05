import {useCallback,useEffect,useState} from 'react';
import {BOOKING_TIMEZONE, minutesNowInTimezone, normalizeBookingDate, todayInTimezone} from './customer/bookingDate';

export type CustomerSlot={time:string;start:string;end:string;staffId:string;totalPaise:number;fallback?:boolean};
type AvailabilityReason='duration_overflow'|'schedule_missing'|'fully_booked'|'no_specialist'|string;
/** Carries the machine-readable error code alongside the human message. */
class AvailabilityError extends Error{code:string;constructor(message:string,code:string){super(message);this.code=code;}}
const availabilityError=(response:Response,payload:any)=>{
  if (payload?.error && typeof payload.error==='string') return payload.error;
  return response.ok ? 'Availability could not be loaded. Please retry.' : `Availability could not be loaded (${response.status}). Please retry.`;
};
const availabilityCode=(response:Response,payload:any)=>{
  if (payload?.code && typeof payload.code==='string') return payload.code;
  return response.ok ? 'availability_failed' : `http_${response.status}`;
};

/** Development/test-only preview slots; these are never treated as server-confirmed capacity. */
export function buildDevelopmentFallbackSlots(date:string, durationMinutes:number, staffId:string, now:Date=new Date()):CustomerSlot[]{
  const normalized=normalizeBookingDate(date);
  const duration=Math.max(0,Number(durationMinutes)||0);
  const open=9*60,close=21*60,step=30;
  if(!normalized||duration<=0||duration>close-open)return [];
  const today=todayInTimezone(now,BOOKING_TIMEZONE);
  const current=today===normalized?minutesNowInTimezone(now,BOOKING_TIMEZONE):-1;
  const slots:CustomerSlot[]=[];
  for(let start=open;start+duration<=close;start+=step){
    if(normalized<today||normalized===today&&start<=current)continue;
    const hh=String(Math.floor(start/60)).padStart(2,'0'),mm=String(start%60).padStart(2,'0');
    slots.push({time:`${hh}:${mm}`,start:'',end:'',staffId:staffId||'any',totalPaise:0,fallback:true});
  }
  return slots;
}

export function useCustomerAvailability(enabled:boolean,subdomain:string,services:string,staffId:string,date:string,durationMinutes=0){
  const [slots,setSlots]=useState<CustomerSlot[]>([]),[error,setError]=useState(''),[code,setCode]=useState(''),[reason,setReason]=useState<AvailabilityReason>(''),[duration,setDuration]=useState<number|null>(null),[fallback,setFallback]=useState(false),[loading,setLoading]=useState(false),[revision,setRevision]=useState(0);
  const key=[subdomain,services,staffId,date,durationMinutes].join('|');
  const [loadedKey,setLoadedKey]=useState('');
  useEffect(()=>{
    if(!enabled)return;
    const controller=new AbortController();
    const requestKey=key;
    setLoading(true);setError('');setCode('');setReason('');setDuration(null);setFallback(false);setSlots([]);setLoadedKey('');
    const query=new URLSearchParams({subdomain:subdomain||'',service_ids:services,staff_id:staffId,date});
    void (async()=>{
      try{
        const response=await fetch('/api/bookings/availability?'+query,{signal:controller.signal});
        let payload:any;
        try{payload=await response.json();}
        catch{throw new AvailabilityError('Availability returned an invalid response. Please retry.','availability_failed');}
        if(!response.ok||!payload?.success)throw new AvailabilityError(availabilityError(response,payload),availabilityCode(response,payload));
        if(controller.signal.aborted)return;
        let nextSlots=Array.isArray(payload.slots)?payload.slots:[];
        let usingFallback=false;
        // Local/dev fixtures should still allow the date-picker flow to be explored
        // if the schedule RPC has no seed data. Production never invents capacity.
        if(!nextSlots.length&&(import.meta.env.DEV||import.meta.env.MODE==='test')){
          nextSlots=buildDevelopmentFallbackSlots(date,Number(payload.durationMinutes)||durationMinutes,staffId);
          usingFallback=nextSlots.length>0;
          if(usingFallback)console.warn('[booking availability] Schedule returned no slots; showing development-only fallback slots. These are not reservable.');
        }
        setSlots(nextSlots);setDuration(Number(payload.durationMinutes)||durationMinutes||null);setReason(payload.availabilityReason||'');setFallback(usingFallback);setLoadedKey(requestKey);
      }catch(e){
        if(!controller.signal.aborted){
          const message=e instanceof Error?e.message:'Availability could not be loaded. Please retry.';
          const errorCode=e instanceof AvailabilityError?e.code:'availability_failed';
          if(import.meta.env.DEV)console.error('[booking availability] Fetch/calculation failed:',{message,code:errorCode,error:e});
          setError(message);setCode(errorCode);
        }
      }finally{if(!controller.signal.aborted)setLoading(false);}
    })();
    return()=>controller.abort();
  },[enabled,key,revision]);
  const refetchSlots=useCallback(()=>setRevision(r=>r+1),[]);
  return {slots:loadedKey===key?slots:[],error,code,reason,durationMinutes:duration,fallback,loading:enabled&&(loading||loadedKey!==key&&!error),refetchSlots,refresh:refetchSlots};
}
