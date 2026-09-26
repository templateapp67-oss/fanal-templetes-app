import {useCallback,useEffect,useState} from 'react';
export type CustomerSlot={time:string;start:string;end:string;staffId:string;totalPaise:number};
/** Carries the machine-readable error code alongside the human message so the UI can tell a permanent state (online booking disabled) from a transient one. */
class AvailabilityError extends Error{code:string;constructor(message:string,code:string){super(message);this.code=code;}}
const availabilityError=(response:Response,payload:any)=>{
  if (payload?.error && typeof payload.error==='string') return payload.error;
  return response.ok ? 'Availability could not be loaded. Please retry.' : `Availability could not be loaded (${response.status}). Please retry.`;
};
const availabilityCode=(response:Response,payload:any)=>{
  if (payload?.code && typeof payload.code==='string') return payload.code;
  return response.ok ? 'availability_failed' : `http_${response.status}`;
};
export function useCustomerAvailability(enabled:boolean,subdomain:string,services:string,staffId:string,date:string){
  const [slots,setSlots]=useState<CustomerSlot[]>([]),[error,setError]=useState(''),[code,setCode]=useState(''),[loading,setLoading]=useState(false),[revision,setRevision]=useState(0);
  const key=[subdomain,services,staffId,date].join('|');
  const [loadedKey,setLoadedKey]=useState('');
  useEffect(()=>{
    if(!enabled)return;
    const controller=new AbortController();setLoading(true);setError('');setCode('');setSlots([]);setLoadedKey('');
    const query=new URLSearchParams({subdomain:subdomain||'',service_ids:services,staff_id:staffId,date});
    fetch('/api/bookings/availability?'+query,{signal:controller.signal}).then(async response=>{
      let payload:any=null;
      try { payload=await response.json(); } catch { throw new AvailabilityError('Availability returned an invalid response. Please retry.','availability_failed'); }
      if(!response.ok||!payload?.success) throw new AvailabilityError(availabilityError(response,payload),availabilityCode(response,payload));
      return payload;
    }).then(result=>{if(!controller.signal.aborted){setSlots(Array.isArray(result.slots)?result.slots:[]);setLoadedKey(key);}}).catch(e=>{if(!controller.signal.aborted){setError(e instanceof Error?e.message:'Availability could not be loaded. Please retry.');setCode(e instanceof AvailabilityError?e.code:'availability_failed');}}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[enabled,key,revision]);
  const refetchSlots=useCallback(()=>setRevision(r=>r+1),[]);
  return {slots:loadedKey===key?slots:[],error,code,loading:enabled&&(loading||loadedKey!==key&&!error),refetchSlots,refresh:refetchSlots};
}
