import{ak as me,F as U,n as he,al as ve,f as $,aS as x,B as W,r as q,a9 as ge,aT as we,k as m,aU as Se,aV as be,aW as ke,E as f,ag as qe,c as Pe,w as I,Y as K,I as Y,ay as ye,a as Te}from"./index.94941811.js";import{u as pe,a as xe,b as Be,c as Ce,d as Ee,e as _e}from"./use-timeout.c47acf2f.js";import{r as R,c as Fe,a as De}from"./private.use-form.448742a8.js";import{r as G,a as $e}from"./focusout.b60bdca6.js";import{u as We,a as Ae}from"./use-dark.c4ccdf0b.js";import{u as T}from"./index.ec7df611.js";function Me(){let e;const a=$();function n(){e=void 0}return me(n),U(n),{removeTick:n,registerTick(l){e=l,he(()=>{e===l&&(ve(a)===!1&&e(),e=void 0)})}}}const B=[];function et(e){return B.find(a=>a.contentEl!==null&&a.contentEl.contains(e))}function Qe(e,a){do{if(e.$options.name==="QMenu"){if(e.hide(a),e.$props.separateClosePopup===!0)return x(e)}else if(e.__qPortal===!0){const n=x(e);return n!==void 0&&n.$options.name==="QPopupProxy"?(e.hide(a),n):e}e=x(e)}while(e!=null)}function tt(e,a,n){for(;n!==0&&e!==void 0&&e!==null;){if(e.__qPortal===!0){if(n--,e.$options.name==="QMenu"){e=Qe(e,a);continue}e.hide(a)}e=x(e)}}const He=W({name:"QPortal",setup(e,{slots:a}){return()=>a.default()}});function ze(e){for(e=e.parent;e!=null;){if(e.type.name==="QGlobalDialog")return!0;if(e.type.name==="QDialog"||e.type.name==="QMenu")return!1;e=e.parent}return!1}function Le(e,a,n,l){const i=q(!1),r=q(!1);let s=null;const c={},u=l==="dialog"&&ze(e);function d(v){if(v===!0){R(c),r.value=!0;return}r.value=!1,i.value===!1&&(u===!1&&s===null&&(s=be(!1,l)),i.value=!0,B.push(e.proxy),Fe(c))}function h(v){if(r.value=!1,v!==!0)return;R(c),i.value=!1;const b=B.indexOf(e.proxy);b!==-1&&B.splice(b,1),s!==null&&(ke(s),s=null)}return ge(()=>{h(!0)}),e.proxy.__qPortal=!0,we(e.proxy,"contentEl",()=>a.value),{showPortal:d,hidePortal:h,portalIsActive:i,portalIsAccessible:r,renderPortal:()=>u===!0?n():i.value===!0?[m(Se,{to:s},m(He,n))]:void 0}}const Oe={transitionShow:{type:String,default:"fade"},transitionHide:{type:String,default:"fade"},transitionDuration:{type:[String,Number],default:300}};function Ve(e,a=()=>{},n=()=>{}){return{transitionProps:f(()=>{const l=`q-transition--${e.transitionShow||a()}`,i=`q-transition--${e.transitionHide||n()}`;return{appear:!0,enterFromClass:`${l}-enter-from`,enterActiveClass:`${l}-enter-active`,enterToClass:`${l}-enter-to`,leaveFromClass:`${i}-leave-from`,leaveActiveClass:`${i}-leave-active`,leaveToClass:`${i}-leave-to`}}),transitionStyle:f(()=>`--q-transition-duration: ${e.transitionDuration}ms`)}}const g=[];let S;function Ie(e){S=e.keyCode===27}function Ke(){S===!0&&(S=!1)}function Re(e){S===!0&&(S=!1,qe(e,27)===!0&&g[g.length-1](e))}function J(e){window[e]("keydown",Ie),window[e]("blur",Ke),window[e]("keyup",Re),S=!1}function Ge(e){Pe.is.desktop===!0&&(g.push(e),g.length===1&&J("addEventListener"))}function j(e){const a=g.indexOf(e);a!==-1&&(g.splice(a,1),g.length===0&&J("removeEventListener"))}let p=0;const je={standard:"fixed-full flex-center",top:"fixed-top justify-center",bottom:"fixed-bottom justify-center",right:"fixed-right items-center",left:"fixed-left items-center"},N={standard:["scale","scale"],top:["slide-down","slide-up"],bottom:["slide-up","slide-down"],right:["slide-left","slide-right"],left:["slide-right","slide-left"]};var at=W({name:"QDialog",inheritAttrs:!1,props:{...pe,...Oe,transitionShow:String,transitionHide:String,persistent:Boolean,autoClose:Boolean,allowFocusOutside:Boolean,noEscDismiss:Boolean,noBackdropDismiss:Boolean,noRouteDismiss:Boolean,noRefocus:Boolean,noFocus:Boolean,noShake:Boolean,seamless:Boolean,maximized:Boolean,fullWidth:Boolean,fullHeight:Boolean,square:Boolean,backdropFilter:String,position:{type:String,default:"standard",validator:e=>["standard","top","bottom","left","right"].includes(e)}},emits:[...xe,"shake","click","escapeKey"],setup(e,{slots:a,emit:n,attrs:l}){const i=$(),r=q(null),s=q(!1),c=q(!1);let u=null,d=null,h,v;const b=f(()=>e.persistent!==!0&&e.noRouteDismiss!==!0&&e.seamless!==!0),{preventBodyScroll:A}=_e(),{registerTimeout:M}=Be(),{registerTick:X,removeTick:Q}=Me(),{transitionProps:Z,transitionStyle:H}=Ve(e,()=>N[e.position][0],()=>N[e.position][1]),ee=f(()=>H.value+(e.backdropFilter!==void 0?`;backdrop-filter:${e.backdropFilter};-webkit-backdrop-filter:${e.backdropFilter}`:"")),{showPortal:z,hidePortal:L,portalIsAccessible:te,renderPortal:ae}=Le(i,r,fe,"dialog"),{hide:P}=Ce({showing:s,hideOnRouteChange:b,handleShow:re,handleHide:ue,processOnMount:!0}),{addToHistory:ne,removeFromHistory:oe}=Ee(s,P,b),ie=f(()=>`q-dialog__inner flex no-pointer-events q-dialog__inner--${e.maximized===!0?"maximized":"minimized"} q-dialog__inner--${e.position} ${je[e.position]}`+(c.value===!0?" q-dialog__inner--animating":"")+(e.fullWidth===!0?" q-dialog__inner--fullwidth":"")+(e.fullHeight===!0?" q-dialog__inner--fullheight":"")+(e.square===!0?" q-dialog__inner--square":"")),y=f(()=>s.value===!0&&e.seamless!==!0),le=f(()=>e.autoClose===!0?{onClick:ce}:{}),se=f(()=>[`q-dialog fullscreen no-pointer-events q-dialog--${y.value===!0?"modal":"seamless"}`,l.class]);I(()=>e.maximized,t=>{s.value===!0&&_(t)}),I(y,t=>{A(t),t===!0?($e(F),Ge(E)):(G(F),j(E))});function re(t){ne(),d=e.noRefocus===!1&&document.activeElement!==null?document.activeElement:null,_(e.maximized),z(),c.value=!0,e.noFocus!==!0?(document.activeElement!==null&&document.activeElement.blur(),X(k)):Q(),M(()=>{if(i.proxy.$q.platform.is.ios===!0){if(e.seamless!==!0&&document.activeElement){const{top:o,bottom:w}=document.activeElement.getBoundingClientRect(),{innerHeight:V}=window,D=window.visualViewport!==void 0?window.visualViewport.height:V;o>0&&w>D/2&&(document.scrollingElement.scrollTop=Math.min(document.scrollingElement.scrollHeight-D,w>=V?1/0:Math.ceil(document.scrollingElement.scrollTop+w-D/2))),document.activeElement.scrollIntoView()}v=!0,r.value.click(),v=!1}z(!0),c.value=!1,n("show",t)},e.transitionDuration)}function ue(t){Q(),oe(),O(!0),c.value=!0,L(),d!==null&&(((t&&t.type.indexOf("key")===0?d.closest('[tabindex]:not([tabindex^="-"])'):void 0)||d).focus(),d=null),M(()=>{L(!0),c.value=!1,n("hide",t)},e.transitionDuration)}function k(t){De(()=>{let o=r.value;if(o!==null){if(t!==void 0){const w=o.querySelector(t);if(w!==null){w.focus({preventScroll:!0});return}}o.contains(document.activeElement)!==!0&&(o=o.querySelector("[autofocus][tabindex], [data-autofocus][tabindex]")||o.querySelector("[autofocus] [tabindex], [data-autofocus] [tabindex]")||o.querySelector("[autofocus], [data-autofocus]")||o,o.focus({preventScroll:!0}))}})}function C(t){t&&typeof t.focus=="function"?t.focus({preventScroll:!0}):k(),n("shake");const o=r.value;o!==null&&(o.classList.remove("q-animate--scale"),o.classList.add("q-animate--scale"),u!==null&&clearTimeout(u),u=setTimeout(()=>{u=null,r.value!==null&&(o.classList.remove("q-animate--scale"),k())},170))}function E(){e.seamless!==!0&&(e.persistent===!0||e.noEscDismiss===!0?e.maximized!==!0&&e.noShake!==!0&&C():(n("escapeKey"),P()))}function O(t){u!==null&&(clearTimeout(u),u=null),(t===!0||s.value===!0)&&(_(!1),e.seamless!==!0&&(A(!1),G(F),j(E))),t!==!0&&(d=null)}function _(t){t===!0?h!==!0&&(p<1&&document.body.classList.add("q-body--dialog"),p++,h=!0):h===!0&&(p<2&&document.body.classList.remove("q-body--dialog"),p--,h=!1)}function ce(t){v!==!0&&(P(t),n("click",t))}function de(t){e.persistent!==!0&&e.noBackdropDismiss!==!0?P(t):e.noShake!==!0&&C()}function F(t){e.allowFocusOutside!==!0&&te.value===!0&&ye(r.value,t.target)!==!0&&k('[tabindex]:not([tabindex="-1"])')}Object.assign(i.proxy,{focus:k,shake:C,__updateRefocusTarget(t){d=t||null}}),U(O);function fe(){return m("div",{role:"dialog","aria-modal":y.value===!0?"true":"false",...l,class:se.value},[m(K,{name:"q-transition--fade",appear:!0},()=>y.value===!0?m("div",{class:"q-dialog__backdrop fixed-full",style:ee.value,"aria-hidden":"true",tabindex:-1,onClick:de}):null),m(K,Z.value,()=>s.value===!0?m("div",{ref:r,class:ie.value,style:H.value,tabindex:-1,...le.value},Y(a.default)):null)])}return ae}}),nt=W({name:"QCard",props:{...We,tag:{type:String,default:"div"},square:Boolean,flat:Boolean,bordered:Boolean},setup(e,{slots:a}){const{proxy:{$q:n}}=$(),l=Ae(e,n),i=f(()=>"q-card"+(l.value===!0?" q-card--dark q-dark":"")+(e.bordered===!0?" q-card--bordered":"")+(e.square===!0?" q-card--square no-border-radius":"")+(e.flat===!0?" q-card--flat no-shadow":""));return()=>m(e.tag,{class:i.value},Y(a.default))}});const ot=Te("welcome",{state:()=>({showWelcome:T("cashu.welcome.showWelcome",!0),currentSlide:T("cashu.welcome.currentSlide",0),seedPhraseValidated:T("cashu.welcome.seedPhraseValidated",!1),termsAccepted:T("cashu.welcome.termsAccepted",!1)}),getters:{isLastSlide:e=>e.currentSlide===3,canProceed:e=>{switch(e.currentSlide){case 0:return!0;case 1:return!0;case 2:return e.seedPhraseValidated;case 3:return e.termsAccepted;default:return!1}},canGoPrev:e=>e.currentSlide>0},actions:{initializeWelcome(){this.showWelcome||(window.location.href="/")},closeWelcome(){this.showWelcome=!1,window.location.href="/"},setCurrentSlide(e){this.currentSlide=e},acceptTerms(){this.termsAccepted=!0},validateSeedPhrase(){this.seedPhraseValidated=!0},resetWelcome(){this.showWelcome=!0,this.currentSlide=0,this.termsAccepted=!1,this.seedPhraseValidated=!1},goToPrevSlide(){this.canGoPrev&&(this.currentSlide-=1)},goToNextSlide(){this.canProceed&&(this.isLastSlide?this.closeWelcome():this.currentSlide+=1)}}});export{at as Q,Oe as a,Ve as b,Le as c,Qe as d,Ge as e,nt as f,ot as g,et as h,tt as i,B as p,j as r,Me as u};