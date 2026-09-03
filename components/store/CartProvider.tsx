/* eslint-disable react-hooks/set-state-in-effect */
"use client";
import {createContext,useContext,useEffect,useMemo,useState} from "react";
import {analyticsEvents,capture} from "@/lib/analytics";
export type CartProduct={id:string;name:string;price:number;image:string;href:string;category?:string};
export type CartLine=CartProduct&{quantity:number};
type Cart={lines:CartLine[];add:(product:CartProduct)=>void;remove:(id:string)=>void;change:(id:string,quantity:number)=>void;count:number;total:number;revision:number};
const Context=createContext<Cart|null>(null),storageKey="dcl-public-cart-v1";
export function CartProvider({children}:{children:React.ReactNode}){const[lines,setLines]=useState<CartLine[]>([]),[ready,setReady]=useState(false),[revision,setRevision]=useState(0);useEffect(()=>{try{setLines(JSON.parse(localStorage.getItem(storageKey)||"[]"))}catch{}setReady(true)},[]);useEffect(()=>{if(ready)localStorage.setItem(storageKey,JSON.stringify(lines))},[lines,ready]);const value=useMemo<Cart>(()=>({lines,add:product=>{capture(analyticsEvents.addToCart,{product_id:product.id,category:product.category,quantity:1});setRevision(value=>value+1);setLines(current=>{const old=current.find(item=>item.id===product.id);return old?current.map(item=>item.id===product.id?{...item,quantity:item.quantity+1}:item):[...current,{...product,quantity:1}]})},remove:id=>{capture(analyticsEvents.removeFromCart,{product_id:id});setLines(current=>current.filter(item=>item.id!==id))},change:(id,quantity)=>setLines(current=>quantity<1?current.filter(item=>item.id!==id):current.map(item=>item.id===id?{...item,quantity}:item)),count:lines.reduce((sum,item)=>sum+item.quantity,0),total:lines.reduce((sum,item)=>sum+item.price*item.quantity,0),revision}),[lines,revision]);return <Context.Provider value={value}>{children}</Context.Provider>}
export function useCart(){const value=useContext(Context);if(!value)throw new Error("CartProvider requerido");return value}
