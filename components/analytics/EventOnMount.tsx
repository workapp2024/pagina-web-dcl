"use client";
import { useEffect, useRef } from "react";
import { capture, type AnalyticsEvent, type AnalyticsProperties } from "@/lib/analytics";
export function EventOnMount({event,properties}:{event:AnalyticsEvent;properties?:AnalyticsProperties}){
  const last = useRef("");
  const signature = JSON.stringify([event, properties]);
  useEffect(()=>{
    if (last.current === signature) return;
    last.current = signature;
    capture(event,properties);
  },[event,properties,signature]);
  return null;
}
