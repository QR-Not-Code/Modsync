if(Platform.isClientEnvironment()&&Platform.isLoaded('patchouli'))(function(){
  var Entry=Java.loadClass('vazkii.patchouli.client.book.gui.GuiBookEntry');
  var Registry=Java.loadClass('vazkii.patchouli.common.book.BookRegistry');
  var Resource=Java.loadClass('net.minecraft.resources.ResourceLocation');
  var Tag=Java.loadClass('net.minecraft.nbt.CompoundTag');
  var List=Java.loadClass('net.minecraft.nbt.ListTag');
  var Stack=Java.loadClass('net.minecraft.world.item.ItemStack');
  var Button=Java.loadClass('net.minecraft.client.gui.components.Button');
  var Component=Java.loadClass('net.minecraft.network.chat.Component');
  var Minecraft=Java.loadClass('net.minecraft.client.Minecraft');
  var RenderSystem=Java.loadClass('com.mojang.blaze3d.systems.RenderSystem');
  var circle=new Resource('serverguide:textures/guide/enchantment_circle.png');
  var Persistent=Java.loadClass('vazkii.patchouli.client.base.PersistentData');
  var ctx=null,hits=[],lastRequest=0,books={},warned={},runtime={},serverRules={},byId={},byEntry={};
  var catalogue=global.kjsEnchantmentCatalogV1||[];
  for(var i=0;i<catalogue.length;i++){byId[catalogue[i].id]=catalogue[i];byEntry[catalogue[i].entry]=catalogue[i];}
  function warn(where,error){if(!warned[where]){warned[where]=true;console.error('[encyclopedia '+where+'] '+error);}}
  function normal(v){return typeof global.kjsGuidePunctuationV1==='function'?global.kjsGuidePunctuationV1(v):String(v);}
  function own(s){return s instanceof Entry&&s.book!=null&&String(s.book.id)==='patchouli:server_rules';}
  function entryId(s){return String(s.getEntry().getId());}
  global.kjsPmenuOpenEnchantmentV1=function(id){
    var row=byId[String(id)];if(row==null)return false;
    var book=Registry.INSTANCE.books.get(new Resource('patchouli:server_rules'));if(book==null)return false;
    var entry=book.getContents().entries.get(new Resource(row.entry));if(entry==null)return false;
    var mc=Minecraft.getInstance(),next=new Entry(book,entry,0);
    if(mc.screen!=null&&typeof mc.screen.displayLexiconGui==='function'&&String(mc.screen.book.id)==='patchouli:server_rules')mc.screen.displayLexiconGui(next,true);
    else mc.setScreen(next);
    return true;
  };
  global.kjsPmenuEnchantmentBookV1=function(id,level){
    var key=String(id)+'@'+Math.max(1,Math.floor(Number(level)||1));if(books[key])return books[key];
    var root=new Tag();root.putString('id','minecraft:enchanted_book');root.putByte('Count',1);
    var tag=new Tag(),list=new List(),ench=new Tag();ench.putString('id',String(id));ench.putShort('lvl',Math.max(1,Math.min(32767,Math.floor(Number(level)||1))));list.add(ench);tag.put('StoredEnchantments',list);root.put('tag',tag);
    var stack=Stack.of(root);books[key]=stack;return stack;
  };
  // Called by client_scripts; NetworkEvents cannot register in startup_scripts.
  global.kjsPmenuAcceptEnchantmentCatalogV1=function(data){
    runtime={};serverRules=data.rules||{};for(var i=0;i<data.entries.length;i++)runtime[data.entries[i].id]=data.entries[i];
    if(ctx!=null)ctx.key='';
  };
  function rows(font,value,width,color){
    if(typeof global.kjsGuideRichRowsV1==='function')return global.kjsGuideRichRowsV1(value,width,color);
    var nativeRows=font.split(Text.of({text:normal(value),font:'minecraft:uniform',color:'#'+('000000'+color.toString(16)).slice(-6),italic:false,bold:false,underlined:false}),width),out=[];
    for(var i=0;i<nativeRows.size();i++){
      var text='';nativeRows.get(i).accept(function(n,style,code){text+=code<=65535?String.fromCharCode(code):String.fromCharCode(0xd800+((code-65536)>>10),0xdc00+((code-65536)&1023));return true;});
      out.push({text:text,color:color});
    }return out;
  }
  function line(g,s,font,value,x,y,color){if(typeof global.kjsGuideRichLineV1==='function'){global.kjsGuideRichLineV1(g,s,value,x,y,108,color,null,{all:true});return;}var text=String(value),width=Number(font.width(text));s.drawCenteredStringNoShadow(g,text,Math.floor(x)+Math.floor(width/2),Math.floor(y),color);}
  function block(g,s,font,value,x,y,width,color,limit){var lines=rows(font,value,width,color);for(var i=0;i<lines.length&&i<limit;i++)if(lines[i].runs)global.kjsGuideRichPaintV1(g,s,lines[i],x,y+i*11,null);else line(g,s,font,lines[i].text,x,y+i*11,color);}
  function chunks(font,blocks){var result=[],page=[];for(var b=0;b<blocks.length;b++){
    if(blocks[b].book){
      if(page.length+2>10){result.push(page);page=[];}
      page.push({book:blocks[b].book,name:blocks[b].name,level:blocks[b].level});page.push({skip:true});continue;
    }
    var lines=rows(font,blocks[b].text,108,blocks[b].color);
    // Flow paragraphs across pages; never leave the effect heading by itself.
    for(var i=0;i<lines.length;i++){if(page.length>=10){result.push(page);page=[];}page.push(lines[i]);}
  }if(page.length||!result.length)result.push(page);return result;}
  ForgeEvents.onEvent('net.minecraftforge.client.event.ScreenEvent$Init$Post',function(event){
    ctx=null;hits=[];
    try{var s=event.getScreen();if(!own(s))return;var row=byEntry[entryId(s)];if(row==null)return;
      var state={screen:s,row:row,page:0,count:1,key:'',pages:[]};ctx=state;
      var addButton=function(label,x,click){var button=Button.builder(Component.literal(label),click).bounds(s.bookLeft+x,s.bookTop+155,50,14).build();event.addListener(button);return button;};
      state.previous=addButton('<',141,function(){state.page=Math.max(0,state.page-1);});
      state.next=addButton('>',199,function(){state.page=Math.min(state.count-1,state.page+1);});
    }catch(error){warn('init',error);}
  });
  function paintIcon(event,s,id,level,x,y){
    var stack=global.kjsPmenuEnchantmentBookV1(id,level),g=event.getGraphics();
    g.renderItem(stack,x,y);
    if(s.isMouseInRelativeRange(event.getMouseX(),event.getMouseY(),x-s.bookLeft-1,y-s.bookTop-1,18,18))s.setTooltipStack(stack);
    hits.push({screen:s,id:id,x:x-1,y:y-1,w:18,h:18});
  }
  ForgeEvents.onEvent('vazkii.patchouli.api.BookDrawScreenEvent',function(event){try{
    var s=event.getScreen();hits=[];if(!own(s))return;
    var mc=s.getMinecraft(),font=mc.font,g=event.getGraphics(),id=entryId(s),row=byEntry[id];
    if(row==null){
      var references=(global.kjsGuideEnchantmentReferencesV1||{})[id];if(!references)return;
      for(var side=0;side<2;side++){
        var page=references[Number(s.getSpread())*2+side]||[];
        for(var j=0;j<page.length;j++){var ref=page[j];hits.push({screen:s,id:ref.id,x:s.bookLeft+(side?141:15)+ref.x-1,y:s.bookTop+18+ref.y-1,w:18,h:18});}
      }return;
    }
    if(ctx==null||!ctx.screen.equals(s))return;
    if(mc.player!=null&&Date.now()-lastRequest>1500){lastRequest=Date.now();mc.player.sendData('kjs_encyclopedia_request_v1',new Tag());}
    var live=runtime[row.id],max=live?(live.registered?Number(live.maxLevel):0):row.maxLevel;
    var parameters=live&&live.parameters?live.parameters:row.parameters;
    var signature=JSON.stringify([max,parameters,live?live.registered:null,serverRules.fancyEPF]);
    if(ctx.key!==signature){
      ctx.key=signature;
      // Put the complete effect first; identifiers and parameters have their own pages.
      var blocks=[{text:'单级强度: '+row.weight+'; 最高等级: '+(max==null?'读取中':max),color:0x246d91}];
      if(row.banned)blocks.push({text:'本服务器禁用. 物品上的该附魔会被移除.',color:0xa04a38});
      if(live&&!live.registered)blocks.push({text:'服务器此版本未注册此附魔.',color:0xa04a38});
      blocks.push({text:'效果与触发条件: ',color:0x347750});
      if(serverRules.fancyEPF&&/protection|feather_falling/.test(row.id))blocks.push({text:'本服启用超上限EPF处理: 有效EPF>20时, 前置伤害再乘1/[1+0.03*(EPF-20)]. 后续还有原版保护处理. 以下80%是原版阶段基准, 不是所有模组叠加的总减伤上限.',color:0xa04a38});
      blocks.push({text:row.effect||'此条目的效果资料尚未提供.',color:0x263945});
      if(row.explanation)blocks.push({text:row.explanation,color:0x263945});
      blocks.push({text:'名称: '+row.name+'\n注册名: '+row.id,color:0x786954});
      if(parameters){var numeric=[];for(var key in parameters)numeric.push((row.parameterLabels&&row.parameterLabels[key]?row.parameterLabels[key]+' ('+key+')':key)+': '+String(parameters[key]).replace(/\d+\.\d{5,}/g,function(v){return String(Math.round(Number(v)*10000)/10000);}));blocks.push({text:(live?'服务器当前参数: ':'资料记录参数: ')+numeric.join('; '),color:0x347750});}
      else if(row.numeric)blocks.push({text:'数值: '+row.numeric,color:0x347750});
      blocks.push({text:'物品书为只读预览, 不会放入背包. 默认上限不禁止管理员或模组生成超限附魔.',color:0x786954});
      ctx.pages=chunks(font,blocks);ctx.max=max==null?0:Math.max(0,Math.floor(max));
    }
    var related=row.related||[],bodySpreads=Math.ceil(ctx.pages.length/2),bookCount=Math.max(1,Math.ceil((ctx.max+related.length)/4));
    ctx.count=bodySpreads+bookCount;ctx.page=Math.min(ctx.page,ctx.count-1);
    if(ctx.page<bodySpreads){
      for(var side=0;side<2;side++){
        var pageIndex=ctx.page*2+side,list=ctx.pages[pageIndex]||[],x=s.bookLeft+(side?141:15);
        if(side)line(g,s,font,pageIndex<ctx.pages.length?'介绍第'+(pageIndex+1)+'/'+ctx.pages.length+'页':'介绍结束',x,s.bookTop+18,0x246d91);
        for(var k=0;k<list.length;k++){
          if(list[k].runs)global.kjsGuideRichPaintV1(g,s,list[k],x,s.bookTop+37+k*11,event);
          else line(g,s,font,list[k].text,x,s.bookTop+37+k*11,list[k].color);
        }
      }
      line(g,s,font,'正文 '+(ctx.page*2+1)+'/'+ctx.pages.length+'页',s.bookLeft+15,s.bookTop+155,0x246d91);
    }else{
      var bookPage=ctx.page-bodySpreads,pose=g.pose();
      RenderSystem.enableBlend();pose.pushPose();try{RenderSystem.setShaderColor(1,1,1,0.18);pose.translate(s.bookLeft+135,s.bookTop+22,0);pose.scale(128/1254,128/1254,1);g.blit(circle,0,0,0,0,1254,1254,1254,1254);}finally{RenderSystem.setShaderColor(1,1,1,1);pose.popPose();}
      block(g,s,font,'预览说明\n\n悬浮查看附魔书属性, 点击打开介绍. 所有预览只读, 不会放进背包.\n\n用<返回完整正文.',s.bookLeft+15,s.bookTop+37,108,0x263945,10);
      line(g,s,font,'附魔书第'+(bookPage+1)+'/'+bookCount+'页',s.bookLeft+141,s.bookTop+18,0x246d91);
      for(var n=0;n<4;n++){
        var index=bookPage*4+n,level=index+1,other=null;if(level>ctx.max){other=byId[related[index-ctx.max]];if(other==null)break;level=1;}
        var previewId=other?other.id:row.id,label=other?'关联: '+other.name:level+'级 '+row.name;
        var xx=s.bookLeft+141,yy=s.bookTop+42+n*26;
        paintIcon(event,s,previewId,level,xx,yy);block(g,s,font,label,xx+22,yy,86,0x6b4897,2);
        hits.push({screen:s,id:previewId,x:xx+20,y:yy,w:88,h:22});
      }
      if(ctx.max===0)block(g,s,font,live&&!live.registered?'服务器未注册此附魔.':'正在读取等级上限...',s.bookLeft+141,s.bookTop+42,108,0x786954,3);
      line(g,s,font,'预览 '+(bookPage+1)+'/'+bookCount+'页',s.bookLeft+15,s.bookTop+155,0x246d91);
    }
    ctx.previous.active=ctx.page>0;ctx.next.active=ctx.page+1<ctx.count;
  }catch(error){warn('draw',error);}});
  ForgeEvents.onEvent('net.minecraftforge.client.event.ScreenEvent$MouseButtonPressed$Pre',function(event){
    if(event.getButton()!==0)return;
    try{
      var s=event.getScreen();if(!own(s))return;
      var mc=s.getMinecraft(),window=mc.getWindow();
      var old=window.calculateScale(Number(mc.options.guiScale().get()),mc.isEnforceUnicode());
      var setting=Math.min(Number(Persistent.data.bookGuiScale),Number(s.maxScale)),now=window.calculateScale(setting,mc.isEnforceUnicode());
      var scale=setting>0&&now!==old?now/window.getGuiScale():1,mx=event.getMouseX()/scale,my=event.getMouseY()/scale;
      for(var i=0;i<hits.length;i++){var hit=hits[i];if(!hit.screen.equals(s)||mx<hit.x||mx>=hit.x+hit.w||my<hit.y||my>=hit.y+hit.h)continue;
        if(global.kjsPmenuOpenEnchantmentV1(hit.id))event.setCanceled(true);return;
      }
    }catch(error){warn('click',error);}
  });
})();
