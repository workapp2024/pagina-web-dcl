"use client";
import { useEffect } from "react";
import { capture, type AnalyticsEvent, type AnalyticsProperties } from "@/lib/analytics";
export function EventOnMount({event,properties}:{event:AnalyticsEvent;properties?:AnalyticsProperties}){useEffect(()=>{capture(event,properties)},[event,properties]);return null}
