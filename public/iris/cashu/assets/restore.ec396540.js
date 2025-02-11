import{a as N}from"./index.927995fe.js";import{u as k}from"./index.463654f8.js";import{g as C,f as b,d as B,X as D,Y as G,Z as I,u as U,G as W,m as X}from"./ui.d5c1e1dd.js";const r=100,M=1,H=N("restore",{state:()=>({showRestoreDialog:k("cashu.restore.showRestoreDialog",!1),restoringState:!1,restoringMint:"",mnemonicToRestore:k("cashu.restore.mnemonicToRestore",""),restoreProgress:0,restoreCounter:0,restoreStatus:""}),getters:{},actions:{restoreMint:async function(n){this.restoringState=!0,this.restoringMint=n,this.restoreProgress=0,this.restoreCounter=0,this.restoreStatus="";try{await this._restoreMint(n)}catch(u){C(`Error restoring mint: ${u}`)}finally{this.restoringState=!1,this.restoringMint="",this.restoreProgress=0}},_restoreMint:async function(n){if(this.mnemonicToRestore.length===0){C("Please enter a mnemonic");return}this.restoreProgress=0;const u=b(),h=B();await h.activateMintUrl(n);const T=this.mnemonicToRestore;this.restoreStatus="Preparing restore process...";const d=new D(n),P=(await d.getKeySets()).keysets;let y=!1,g=P.length*M,a=0;for(const t of P){console.log(`Restoring keyset ${t.id} with unit ${t.unit}`);const A=u.mnemonicToSeedSync(T),w=new G(d,{bip39seed:A,unit:t.unit});let c=0,m=0,f=[];for(;m<M;){console.log(`Restoring proofs ${c} to ${c+r}`);const e=(await w.restore(c,r,{keysetId:t.id})).proofs;e.length===0?(console.log(`No proofs found for keyset ${t.id}`),m++):(console.log(`> Restored ${e.length} proofs with sum ${e.reduce((s,p)=>s+p.amount,0)}`),f=f.concat(e),m=0,this.restoreCounter+=e.length,g+=1),this.restoreStatus=`Restored ${this.restoreCounter} proofs for keyset ${t.id}`,c+=r,a++,this.restoreProgress=a/g}let S=[];for(let e=0;e<f.length;e+=r){this.restoreStatus=`Checking proofs ${e} to ${e+r} for keyset ${t.id}`;const s=f.slice(e,e+r),p=await w.checkProofsStates(s),_=s.filter((o,i)=>p[i].state===I.SPENT).map(o=>o.secret),l=s.filter(o=>!_.includes(o.secret));l.length>0&&console.log(`Found ${l.length} unspent proofs with sum ${l.reduce((o,i)=>o+i.amount,0)}`);const R=l.filter(o=>!h.proofs.some(i=>i.secret===o.secret));h.addProofs(R),S=S.concat(R),a++,this.restoreProgress=a/g}const $=S.reduce((e,s)=>e+s.amount,0),E=U().formatCurrency($,t.unit);$>0&&(W(`Restored ${E}`),y=!0)}y||X("No proofs found to restore")}}});export{H as u};
