import {useCallback,useEffect,useState} from 'react';
export type CustomerSlot={time:string;start:string;end:string;staffId:string;totalPaise:number};
const availabilityError=(response:Response,payload:any)=>{
  if (payload?.error && typeof payload.error==='string') return payload.error;
  return response.ok ? 'Availability could not be loaded. Please retry.' : `Availability could not be loaded (${response.status}). Please retry.`;
};
export function useCustomerAvailability(enabled:boolean,subdomain:string,services:string,staffId:string,date:string){
  const [slots,setSlots]=useState<CustomerSlot[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false),[revision,setRevision]=useState(0);
  const key=[subdomain,services,staffId,date].join('|');
  const [loadedKey,setLoadedKey]=useState('');
  useEffect(()=>{
    if(!enabled)return;
    const controller=new AbortController();setLoading(true);setError('');setSlots([]);setLoadedKey('');
    const query=new URLSearchParams({subdomain:subdomain||'',service_ids:services,staff_id:staffId,date});
    fetch('/api/bookings/availability?'+query,{signal:controller.signal}).then(async response=>{
      let payload:any=null;
      try { payload=await response.json(); } catch { throw new Error('Availability returned an invalid response. Please retry.'); }
      if(!response.ok||!payload?.success) throw new Error(availabilityError(response,payload));
      return payload;
    }).then(result=>{if(!controller.signal.aborted){setSlots(Array.isArray(result.slots)?result.slots:[]);setLoadedKey(key);}}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Availability could not be loaded. Please retry.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[enabled,key,revision]);
  const refetchSlots=useCallback(()=>setRevision(r=>r+1),[]);
  return {slots:loadedKey===key?slots:[],error,loading:enabled&&(loading||loadedKey!==key&&!error),refetchSlots,refresh:refetchSlots};
}
