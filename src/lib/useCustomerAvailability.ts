import {useEffect,useState} from 'react';
export type CustomerSlot={time:string;start:string;end:string;staffId:string;totalPaise:number};
export function useCustomerAvailability(enabled:boolean,subdomain:string,services:string,staffId:string,date:string){
  const [slots,setSlots]=useState<CustomerSlot[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false),[revision,setRevision]=useState(0);
  const key=[subdomain,services,staffId,date].join('|');
  const [loadedKey,setLoadedKey]=useState('');
  useEffect(()=>{
    if(!enabled)return;
    const controller=new AbortController();setLoading(true);setError('');setSlots([]);setLoadedKey('');
    const query=new URLSearchParams({subdomain:subdomain||'',service_ids:services,staff_id:staffId,date});
    fetch('/api/bookings/availability?'+query,{signal:controller.signal}).then(async r=>{const result=await r.json();if(!r.ok||!result.success)throw new Error(result.error||'Availability could not be loaded.');return result;}).then(result=>{if(!controller.signal.aborted){setSlots(result.slots);setLoadedKey(key);}}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[enabled,key,revision]);
  return {slots:loadedKey===key?slots:[],error,loading:enabled&&(loading||loadedKey!==key&&!error),refresh:()=>setRevision(r=>r+1)};
}
