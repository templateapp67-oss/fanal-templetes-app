import './jsdomSetup';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {SalonCard} from '../../src/customer/screens/Discover';
import {toCustomerSalon} from '../../src/lib/customer/mappers';
test('salon cards expose required facts and separate profile and booking actions',()=>{
 const salon={...toCustomerSalon({id:'salon',salon_name:'New Salon',subdomain:'new-salon',city:'Jaipur',full_address:'Niwaru Road'}, {serviceCount:1,minServicePrice:350,rating:{average:4.8,count:20},recentBookings:12}),verified:true,area:'Niwaru Road'};
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);let opened=0,booked=0;
 act(()=>root.render(<SalonCard salon={salon} accentHex="#333333" onOpen={()=>opened++} onBook={()=>booked++}/>));
 try {
  const text=container.textContent || '';
  for(const value of ['Verified','Top Rated','Trending',"Today's available slots",'Niwaru Road','350','View Profile','Book Now']) assert.ok(text.includes(value),value);
  assert.ok(container.querySelector('img[alt="New Salon cover"]'));
  const buttons=[...container.querySelectorAll('button')];
  act(()=>buttons.find(b=>b.textContent?.trim()==='View Profile')!.click());assert.equal(opened,1);assert.equal(booked,0);
  act(()=>buttons.find(b=>b.textContent?.trim()==='Book Now')!.click());assert.equal(booked,1);
 } finally {act(()=>root.unmount());container.remove();}
});
