/**
 * Stylesheet for the visual effects ("vfx"). Each effect is a one-square
 * element placed on a board square (class `square-FR`) inside one of the
 * `vfx-below` / `vfx-above` layers and animated with CSS keyframes.
 */
export const VFX_CSS = `
.vfx{height:12.5%;left:0;position:absolute;top:0;touch-action:none;width:12.5%;will-change:transform;pointer-events:none}
.vfx .element{background-size:100%;cursor:default;height:100%;width:100%}

/* captured piece: grows and fades */
.vfx.vfx-piece-capture .element{animation:vfx-capture-fade .4s ease-in-out forwards;overflow:visible;transform-origin:center 90%}
@keyframes vfx-capture-fade{0%{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(2)}}

/* growing circle under a landed piece */
.vfx.vfx-growing-circle{overflow:hidden}
.vfx.vfx-growing-circle .growing-circle{animation:vfx-circle-opacity .3s ease-in-out forwards,vfx-circle-expand .4s cubic-bezier(.33,1,.68,1) forwards;background-color:var(--growing-circle-color,#000);border-radius:100%;height:100%;left:50%;position:absolute;top:50%;width:100%;z-index:2}
@keyframes vfx-circle-opacity{0%{opacity:var(--growing-circle-initial-opacity,.07)}to{opacity:0}}
@keyframes vfx-circle-expand{0%{transform:translate(-50%,-50%) scale(.6)}to{opacity:0;transform:translate(-50%,-50%) scale(1.5)}}

/* piece trail */
.vfx-piece-trail .trail-segment{--piece-move-duration:.22s;--trail-width:0%;--trail-scale-duration:var(--piece-move-duration);--trail-fadeout-duration:.3s;border-radius:999px;height:40%;left:50%;opacity:1;position:absolute;top:50%;transform:translateY(-50%) rotate(var(--rotation)) scaleX(0);transform-origin:0 50%;width:var(--trail-width)}
.vfx-piece-trail .trail-segment.animating{animation:vfx-trail-scale var(--trail-scale-duration) ease-in-out forwards,vfx-trail-fadeout var(--trail-fadeout-duration) ease-out var(--trail-scale-duration) forwards}
@keyframes vfx-trail-scale{0%{transform:translateY(-50%) rotate(var(--rotation)) scaleX(0)}to{transform:translateY(-50%) rotate(var(--rotation)) scaleX(1)}}
@keyframes vfx-trail-fadeout{0%{opacity:1}to{opacity:0}}

/* king in check */
.vfx.vfx-king-check-square .square{--grow-duration:50ms;--shrink-duration:.25s;--overlay-start-delay:.1s;--overlay-total-delay:calc(var(--grow-duration) + var(--shrink-duration) + var(--overlay-start-delay));animation:vfx-kcs-grow var(--grow-duration) linear,vfx-kcs-shrink var(--shrink-duration) cubic-bezier(.16,1,.3,1) var(--grow-duration);background-image:var(--bg-image);background-position:var(--file) var(--rank);background-size:800%;height:100%;width:100%}
.flipped .vfx.vfx-king-check-square .square{background-position:calc(100% - var(--file)) calc(100% - var(--rank))}
.vfx.vfx-king-check-square .color-overlay{animation:vfx-kcs-pulse 2s cubic-bezier(.33,1,.68,1) var(--overlay-total-delay) infinite;background-color:#e63946;height:100%;opacity:.55;width:100%}
@keyframes vfx-kcs-grow{0%{transform:scale(1)}to{transform:scale(1.15)}}
@keyframes vfx-kcs-shrink{0%{transform:scale(1.15)}to{transform:scale(1)}}
@keyframes vfx-kcs-pulse{0%{opacity:.55}50%{opacity:.25}to{opacity:.55}}
.vfx.vfx-king-check .element{animation:vfx-kc-grow 50ms linear forwards,vfx-kc-wiggle .2s linear 50ms 5 forwards,king-check-shrink .25s cubic-bezier(.16,1,.3,1) 1.05s forwards;overflow:visible;position:relative}
@keyframes vfx-kc-grow{0%{transform:scale(1)}to{transform:scale(1.1)}}
@keyframes vfx-kc-wiggle{0%{transform:scale(1.1) rotate(0)}25%{transform:scale(1.1) rotate(-4deg)}50%{transform:scale(1.1) rotate(0)}75%{transform:scale(1.1) rotate(4deg)}to{transform:scale(1.1) rotate(0)}}
@keyframes king-check-shrink{0%{transform:scale(1.1)}to{transform:scale(1)}}

/* illegal move tapped */
.vfx.vfx-illegal-move-tap{overflow:hidden}
.vfx.vfx-illegal-move-tap .illegal-move-tap-overlay{animation:illegal-move-tap-overlay-fade .7s cubic-bezier(.33,1,.68,1) forwards;background-color:#e63946;height:100%;left:0;opacity:.55;position:absolute;top:0;width:100%;z-index:1}
.vfx.vfx-illegal-move-tap .illegal-move-tap-circle{animation:vfx-imt-opacity .3s ease-in-out forwards,vfx-imt-expand .4s cubic-bezier(.33,1,.68,1) forwards;background-color:#000;border-radius:100%;height:100%;left:50%;position:absolute;top:50%;width:100%;z-index:2}
@keyframes illegal-move-tap-overlay-fade{0%{opacity:.55}to{opacity:0}}
@keyframes vfx-imt-opacity{0%{opacity:.07}to{opacity:0}}
@keyframes vfx-imt-expand{0%{transform:translate(-50%,-50%) scale(.6)}to{opacity:0;transform:translate(-50%,-50%) scale(1.5)}}

/* promotion */
.vfx.vfx-piece-promote .element{animation:piece-promote-scale .2s forwards}
@keyframes piece-promote-scale{0%{animation-timing-function:cubic-bezier(.16,1,.3,1);scale:1}50%{animation-timing-function:cubic-bezier(0,.55,.45,1);scale:1.35}to{scale:1}}
.vfx.vfx-promote-ripple{overflow:visible}
.vfx.vfx-promote-ripple .circle{background-color:#fff;border-radius:50%;box-shadow:0 0 1px 1px #fffc;height:100%;left:50%;position:absolute;top:50%;width:100%}
.vfx.vfx-promote-ripple .circle-out-cubic{animation:vfx-pr-small .35s cubic-bezier(.33,1,.68,1) forwards,promote-ripple-fade .35s linear forwards}
.vfx.vfx-promote-ripple .circle-in-out-back{animation:vfx-pr-large .35s cubic-bezier(.68,-.6,.32,1.6) forwards,promote-ripple-fade .35s linear forwards}
@keyframes vfx-pr-small{0%{transform:translate(-50%,-50%) scale(.6)}to{transform:translate(-50%,-50%) scale(1.6)}}
@keyframes vfx-pr-large{0%{transform:translate(-50%,-50%) scale(.6)}to{transform:translate(-50%,-50%) scale(2)}}
@keyframes promote-ripple-fade{0%{opacity:.4}to{opacity:0}}

/* playful extras: jump / slam, throw, flip, charge-jump, hand throw, boxing glove */
.vfx.vfx-piece-jump .element{overflow:visible;position:relative}
.vfx .piece-jump-and-wiggle{animation:waiting var(--initial-delay) forwards,piece-jump .4s cubic-bezier(.25,1,.5,1) var(--initial-delay) forwards,piece-wiggle-1 .2s cubic-bezier(.37,0,.63,1) var(--initial-delay) forwards,piece-wiggle-2 .2s cubic-bezier(.37,0,.63,1) calc(var(--initial-delay) + .2s) forwards}
.vfx .piece-jump-and-fall-over{animation:waiting var(--initial-delay) forwards,piece-jump .4s cubic-bezier(.25,1,.5,1) var(--initial-delay) forwards,piece-fall-over .4s cubic-bezier(.34,1.56,.64,1) var(--initial-delay) forwards}
.vfx .fallen-piece-jump{animation:waiting var(--initial-delay) forwards,piece-jump .4s cubic-bezier(.25,1,.5,1) var(--initial-delay) forwards}
.vfx .piece-fall-and-rest{animation:piece-reset-y .2s cubic-bezier(.34,1.56,.64,1) forwards,piece-set-rest-rotation .2s cubic-bezier(.65,0,.35,1) forwards}
@keyframes piece-jump{0%{left:0;top:0}to{left:var(--jump-x);top:var(--jump-y)}}
@keyframes piece-wiggle-1{0%{transform:rotate(var(--initial-rotation))}to{transform:rotate(calc(var(--wiggle-deg) * -1))}}
@keyframes piece-wiggle-2{0%{transform:rotate(calc(var(--wiggle-deg) * -1))}to{transform:rotate(var(--wiggle-deg))}}
@keyframes piece-fall-over{0%{transform:rotate(0)}to{transform:rotate(var(--fall-deg))}}
@keyframes piece-reset-y{0%{left:var(--jump-x);top:var(--jump-y)}to{left:0;top:0}}
@keyframes piece-set-rest-rotation{0%{transform:rotate(var(--fall-deg,var(--wiggle-deg)))}to{transform:rotate(var(--fall-deg,0deg))}}
@keyframes waiting{0%{transform:rotate(var(--initial-rotation))}to{transform:rotate(var(--initial-rotation))}}
.vfx.vfx-piece-throw .element{overflow:visible;position:absolute}
.vfx .piece-throw-and-spin{--throw-duration:1s;animation:piece-throw-x var(--throw-duration) linear var(--initial-delay,0ms) forwards,piece-throw-y var(--throw-duration) cubic-bezier(.33,1,.68,1) var(--initial-delay,0ms) forwards,piece-spin var(--throw-duration) linear var(--initial-delay,0ms) forwards}
@keyframes piece-throw-x{0%{left:0}to{left:var(--throw-x)}}
@keyframes piece-throw-y{0%{top:0}to{top:var(--throw-y)}}
@keyframes piece-spin{0%{transform:rotate(0) scale(1)}to{transform:rotate(var(--spin-deg)) scale(var(--scale))}}
.vfx.vfx-hand-throw .hand-throw-image{display:block;height:100%;object-fit:contain;opacity:1;pointer-events:none;position:absolute;top:50%;width:100%;left:50%;transform:translate(-50%,-50%) scale(.75)}
.vfx .hand-throw-animate{animation:hand-throw-appear var(--hand-throw-appear-duration,.15s) cubic-bezier(.33,1,.68,1) forwards,hand-throw-throw var(--hand-throw-throw-duration,.2s) cubic-bezier(.33,1,.68,1) var(--hand-throw-appear-duration,.15s) forwards,hand-throw-fade var(--hand-throw-fade-duration,.8s) ease-out calc(var(--hand-throw-appear-duration,.15s) + var(--hand-throw-throw-duration,.2s)) forwards}
@keyframes hand-throw-appear{0%{opacity:.6;transform:translate(-50%,-50%) rotate(var(--hand-throw-appear-rotation)) scale(.6)}to{opacity:1;transform:translate(-50%,-50%) rotate(0) scale(1)}}
@keyframes hand-throw-throw{0%{transform:translate(-50%,-50%) rotate(0) scale(1)}to{transform:translate(-50%,calc(-50% + var(--hand-throw-throw-dy,-8%))) rotate(0) scale(var(--hand-throw-throw-scale-x,1.5),var(--hand-throw-throw-scale-y,1.5))}}
@keyframes hand-throw-fade{0%{opacity:1;transform:translate(-50%,calc(-50% + var(--hand-throw-throw-dy,-8%))) rotate(0) scale(var(--hand-throw-throw-scale-x,1.5),var(--hand-throw-throw-scale-y,1.5))}to{opacity:0;transform:translate(-50%,-50%) rotate(0) scale(1)}}
.vfx.vfx-piece-flip .element{overflow:visible;transform-origin:50% 25%}
.vfx.vfx-piece-flip.flip-cw .element{animation:piece-flip-rotate-cw .45s cubic-bezier(.6,-.28,.735,.045) forwards,piece-flip-scale 1s forwards,piece-flip-translate 1s forwards}
.vfx.vfx-piece-flip.flip-ccw .element{animation:piece-flip-rotate-ccw .45s cubic-bezier(.6,-.28,.735,.045) forwards,piece-flip-scale 1s forwards,piece-flip-translate 1s forwards}
@keyframes piece-flip-rotate-cw{0%{rotate:0deg}to{rotate:360deg}}
@keyframes piece-flip-rotate-ccw{0%{rotate:0deg}to{rotate:-360deg}}
@keyframes piece-flip-scale{0%{animation-timing-function:linear;scale:1 1}10%{animation-timing-function:cubic-bezier(.33,1,.68,1);scale:1 1}40%{animation-timing-function:linear;scale:1 .9}50%{animation-timing-function:linear;scale:1 .9}60%{scale:1 1.08}70%{scale:1 .97}80%{scale:1 1.02}90%{scale:1 .99}to{scale:1 1}}
@keyframes piece-flip-translate{0%{animation-timing-function:linear;translate:0 0}10%{animation-timing-function:cubic-bezier(.33,1,.68,1);translate:0 0}40%{animation-timing-function:linear;translate:0 -50%}50%{translate:0 8%}58%{translate:0 -3%}66%{translate:0 1%}76%{translate:0 0}90%,to{translate:0 0}}
.vfx.vfx-charge-jump .element{animation:charge-jump-compress 1.5s cubic-bezier(.33,1,.68,1) forwards,charge-jump-shake .12s ease-in-out infinite;overflow:visible;transform-origin:center 90%}
.vfx.vfx-charge-jump .element.jumping{animation:charge-jump-scale .8s forwards,charge-jump-translate .8s forwards}
@keyframes charge-jump-compress{0%{scale:1 1}to{scale:1 .6}}
@keyframes charge-jump-shake{0%{translate:0 0}25%{translate:1.5%}50%{translate:0 0}75%{translate:-1.5%}to{translate:0 0}}
@keyframes charge-jump-scale{0%{animation-timing-function:cubic-bezier(.33,1,.68,1);scale:1 var(--start-compression,1)}30%{animation-timing-function:cubic-bezier(.33,1,.68,1);scale:1 1.05}55%{animation-timing-function:ease-out;scale:1 .9}70%{animation-timing-function:ease-out;scale:1 1.05}85%{animation-timing-function:ease-out;scale:1 .98}to{scale:1 1}}
@keyframes charge-jump-translate{0%{animation-timing-function:cubic-bezier(.33,1,.68,1);translate:0 0}30%{animation-timing-function:cubic-bezier(.32,0,.67,0);translate:0 var(--jump-height,-50%)}55%{translate:0 8%}70%{translate:0 -3%}85%{translate:0 1%}to{translate:0 0}}
.board.hide-pieces .piece{display:none}
.boxing-glove-cursor{height:var(--boxing-glove-size,48px);opacity:0;pointer-events:none;position:absolute;top:0;left:0;transition:opacity .12s ease;width:var(--boxing-glove-size,48px);z-index:50}
.boxing-glove-cursor img,.boxing-glove-cursor .glove{display:block;height:100%;width:100%;font-size:calc(var(--boxing-glove-size,48px) * .8);line-height:1;text-align:center}
.boxing-glove-cursor--active{opacity:1}
.boxing-glove-cursor--punch img,.boxing-glove-cursor--punch .glove{animation:boxing-glove-punch .2s cubic-bezier(.22,1,.36,1) forwards}
.boxing-glove-stars{pointer-events:none;position:absolute;top:0;left:0;z-index:51;transform:translate(-50%,-50%)}
.boxing-glove-star{--dx:0;--dy:0;animation:boxing-glove-star .52s ease-out forwards;background:#ffd54f;box-shadow:0 0 2px #00000040;clip-path:polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%);height:48px;position:absolute;width:48px}
@keyframes boxing-glove-punch{0%{transform:scale(1)}40%{transform:scale(.5)}to{transform:scale(1)}}
@keyframes boxing-glove-star{0%{opacity:1;transform:translate(0) scale(1)}to{opacity:0;transform:translate(var(--dx),var(--dy)) scale(.25)}}
`;
