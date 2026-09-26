/* Frequent English words, bigrams and trigrams for the exercise generator. */
window.TG = window.TG || {};
TG.DATA = TG.DATA || {};
TG.DATA.en = TG.DATA.en || {};

TG.DATA.en.words = (
  'the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an will my ' +
  'one all would there their what so up out if about who get which go me when make can like time no just him know take people ' +
  'into year your good some could them see other than then now look only come its over think also back after use two how our ' +
  'work first well way even new want because any these give day most us is was are been has had did said made went took ' +
  'find here thing many tell very through long where much should need feel high old last great little own right big man ' +
  'woman child world school still every house home life hand part place case week company system program question during ' +
  'government number night point water room mother area money story fact month lot study book eye job word business issue ' +
  'side kind head far black long both little really left early young important few public bad same able change play move ' +
  'live believe hold bring happen write provide sit stand lose pay meet include continue set learn lead understand watch ' +
  'follow stop create speak read allow add spend grow open walk win offer remember love consider appear buy wait serve die ' +
  'send expect build stay fall cut reach kill remain suggest raise pass sell require report decide pull ' +
  'city tree road river sea sky sun moon star rain snow wind cloud grass flower bird cat dog fish bread milk tea coffee garden ' +
  'fire stone hill lake field forest morning evening today tomorrow yesterday always never often sometimes quickly slowly ' +
  'quiet loud easy hard simple clear bright dark warm cold fresh clean ready whole true happy strong small large short ' +
  'keyboard finger key type text letter line speed practice habit rhythm lesson focus accuracy memory skill touch ' +
  'music song picture film game sport ball train plane ticket station park bridge leaf root apple pear berry soup cheese ' +
  'butter sugar salt dinner lunch breakfast holiday gift guest teacher student doctor engineer writer poet hero example ' +
  'task mistake result success experience knowledge science nature weather island valley path window door table chair ' +
  'screen button page chapter phrase sentence paragraph desk wrist shoulder posture ' +
  // home row and early-lesson words
  'a add ads all ask as dad fad fall flag flask gag glass had half hall has jag lad lag lass salad sash shall ' +
  'dash fads gash lash sad sag alas alfalfa gala hag jazz ' +
  'sea see seed feed fee lead leaf deal sale sells shelf field fields hide ride aside idea ideas fire free tree ' +
  'kid kids like likes jail sail said slid silk skill fill hill kill ill die dies lie lies side sides'
).split(/\s+/).filter(Boolean);

TG.DATA.en.bigrams = ('th he in er an re on at en nd ti es or te of ed is it al ar st to nt ng se ha as ou io le ve co me de ' +
  'hi ri ro ic ne ea ra ce li ch ll be ma si om ur').split(' ');

TG.DATA.en.trigrams = ('the and ing ion tio ent ati for her ter hat tha ere ate his con res ver all ons nce men ith ted ers ' +
  'pro thi wit are ess not ive was ect rea com eve per int est sta cti ica ist ear ain one our').split(' ');
