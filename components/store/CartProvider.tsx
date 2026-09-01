"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
export type CartProduct = { id:string; name:string; price:number; image:string; href:string };
export type CartLine = CartProduct & { quantity:number };
type Cart = { lines:CartLine[]; add:(p:CartProduct)=>void; remove:(id:string)=>void; change:(id:string,q:number)=>void; count:number; total:number };
const Context=createContext<Cart|null>(null); const key="dcl-public-cart-v1";
export function CartProvider({children}:{children:React.ReactNode}) { const [lines,setLines]=useState<CartLine[]>([]); const [ready,setReady]=useState(false); useEffect(()=>{try{setLines(JSON.parse(localStorage.getItem(key)||"[]"))}catch{}setReady(true)},[]); useEffect(()=>{if(ready)localStorage.setItem(key,JSON.stringify(lines))},[lines,ready]); const value=useMemo<Cart>(()=>({lines,add:p=>setLines(x=>{const old=x.find(i=>i.id===p.id);return old?x.map(i=>i.id===p.id?{...i,quantity:i.quantity+1}:i):[...x,{...p,quantity:1}]}),remove:id=>setLines(x=>x.filter(i=>i.id!==id)),change:(id,q)=>setLines(x=>q<1?x.filter(i=>i.id!==id):x.map(i=>i.id===id?{...i,quantity:q}:i)),count:lines.reduce((n,i)=>n+i.quantity,0),total:lines.reduce((n,i)=>n+i.price*i.quantity,0)}),[lines]); return <Context.Provider value={value}>{children}</Context.Provider> }
export function useCart(){const value=useContext(Context);if(!value)throw new Error("CartProvider requerido");return value}
