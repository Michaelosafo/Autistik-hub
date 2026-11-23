/** Client: the desk query the open trader page uses (e.g. "?desk=liq&team=1" for BnbRage's shared SniperBNB). */
let current = "";
export const setDeskQuery = (q: string) => { current = q; };
/** The sniper's query: the page's, when the page is the sniper (keeps &team=1), else plain ?desk=liq. */
export const liqQuery = () => (current.startsWith("?desk=liq") ? current : "?desk=liq");
