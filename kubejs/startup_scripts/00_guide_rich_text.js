if(Platform.isClientEnvironment()&&Platform.isLoaded('patchouli'))(function(){
  var Entry=Java.loadClass('vazkii.patchouli.client.book.gui.GuiBookEntry');
  var Tag=Java.loadClass('net.minecraft.nbt.CompoundTag');
  var Stack=Java.loadClass('net.minecraft.world.item.ItemStack');
  var Resource=Java.loadClass('net.minecraft.resources.ResourceLocation');
  var Registries=Java.loadClass('net.minecraftforge.registries.ForgeRegistries');
  var Minecraft=Java.loadClass('net.minecraft.client.Minecraft');
  var Persistent=Java.loadClass('vazkii.patchouli.client.base.PersistentData');
  var trie=false,stackCache={},painters={},lastScreen=false,clicks=[],errors={};
  function warn(key,e){if(!errors[key]){errors[key]=true;console.error('[guide rich '+key+'] '+e);}}
  function normalize(v){return typeof global.kjsGuidePunctuationV1==='function'?global.kjsGuidePunctuationV1(v):String(v);}
  function descriptor(name){
    var d=(global.kjsGuideItemNamesV1||{})[name];
    if(!d)return false;
    var choices=Array.isArray(d)?d:[d];
    for(var i=0;i<choices.length;i++)if(Registries.ITEMS.containsKey(new Resource(choices[i].id)))return choices[i];
    return false;
  }
  function init(){if(trie)return;trie={};var names=global.kjsGuideItemNamesV1||{};
    for(var name in names){if(name.length<2||/^[A-Za-z]+$/.test(name)||/^(火矢|荆棘|跨板|文件)$/.test(name))continue;var actual=descriptor(name);if(!actual)continue;var n=trie;for(var i=0;i<name.length;i++){var c=name.charAt(i);if(!n[c])n[c]={};n=n[c];}n.value=actual;}
  }
  function match(text,start){init();var n=trie,result=false;
    for(var i=start;i<text.length;i++){n=n[text.charAt(i)];if(!n)break;if(n.value){var length=i-start+1,name=text.substr(start,length),before=start?text.charAt(start-1):'',after=text.charAt(i+1);
        // Two-character Chinese names must occur as a standalone list/name or in an explicit item context.
        var standalone=!/[\u3400-\u9fffA-Za-z0-9_]/.test(before)&&!/[\u3400-\u9fffA-Za-z0-9_]/.test(after);
        var context=/(?:消耗|获得|使用|放入|拿着|手持|掉落|合成|制作|装备|物品[: ]*)$/.test(text.slice(Math.max(0,start-12),start));
        if(length>=3||standalone||context)result={data:n.value,length:length};}}return result;
  }
  var glyphWidths={};
  function component(body,color,italic){return Text.of({text:body,color:'#'+('000000'+color.toString(16)).slice(-6),font:'minecraft:uniform',bold:false,italic:!!italic,underlined:false});}
  function measure(font,sequence,plain){
    try{return Number(font.width(sequence));}
    catch(e){warn('uniform width fallback',e);var widths=global.kjsGuideUniformAdvancesV1||{},total=0;for(var i=0;i<plain.length;i++){var c=plain.charAt(i);total+=widths[c]==null?(c.charCodeAt(0)>127?9:6):Number(widths[c]);}return total;}
  }
  function advance(c){
    if(glyphWidths[c]==null){var mc=Minecraft.getInstance();glyphWidths[c]=measure(mc.font,component(c,0x263945,false).getVisualOrderText(),c);}
    return glyphWidths[c];
  }
  // Conservative widths include the icon slot. All drawing uses uniform font.
  function layout(value,width,color,skip){
    var text=normalize(value),pages=[],row={runs:[]},used=0,style={color:color||0x263945,italic:false,command:'',link:''};skip=skip||{};
    function flush(){pages.push(row);row={runs:[]};used=0;}
    function put(run,w){if(used+w>width&&row.runs.length)flush();run.width=w;
      var prev=row.runs.length?row.runs[row.runs.length-1]:false;
      if(!run.item&&prev&&!prev.item&&prev.color===run.color&&prev.prefix===run.prefix&&prev.command===run.command&&prev.link===run.link){prev.text+=run.text;prev.width+=w;}
      else row.runs.push(run);used+=w;
    }
    for(var i=0;i<text.length;){
      if(text.substr(i,2)==='$('){var end=text.indexOf(')',i+2);if(end!==-1){var code=text.substring(i+2,end);i=end+1;
        if(code==='br'||code==='br2'){flush();if(code==='br2')flush();}
        else if(code==='playername')put({text:'$(playername)',color:style.color,prefix:style.italic?'\u00a7o':'',command:'',link:''},84);
        else if(code.indexOf('item:')===0){var explicit={id:code.slice(5)};if(!skip.all&&!skip[explicit.id]&&Registries.ITEMS.containsKey(new Resource(explicit.id)))put({item:explicit,text:'',color:style.color,prefix:'',command:'',link:''},10);}
        else if(code==='o'||code==='italic')style.italic=true;
        else if(/^#[0-9a-fA-F]{6}$/.test(code))style.color=parseInt(code.slice(1),16);
        else if(code.indexOf('c:')===0)style.command=code.slice(2);
        else if(code.indexOf('l:')===0)style.link=code.slice(2);
        else if(code==='/c')style.command='';else if(code==='/l')style.link='';
        else if(code==='')style={color:color||0x263945,italic:false,command:'',link:''};
        continue;
      }}
      if(text.charAt(i)==='\n'){flush();i++;continue;}
      var token=(i===0||!/[A-Za-z0-9_:/.-]/.test(text.charAt(i-1)))?/^[A-Za-z0-9_:/.-]+/.exec(text.slice(i)):false;
      if(token){var wordWidth=0;for(var wi=0;wi<token[0].length;wi++)wordWidth+=advance(token[0].charAt(wi));if(wordWidth<=width&&used&&used+wordWidth>width)flush();}
      var found=style.command?false:match(text,i);
      if(found&&!skip.all&&!skip[found.data.id]){put({item:found.data,text:'',color:style.color,prefix:'',command:'',link:''},10);}
      var length=found?found.length:1;
      for(var j=0;j<length;j++){var ch=text.charAt(i+j);put({text:ch,color:style.color,prefix:style.italic?'\u00a7o':'',command:style.command,link:style.link},advance(ch));}
      i+=length;
    }
    if(row.runs.length||!pages.length)pages.push(row);return pages;
  }
  function stack(d){if(d.name){d=descriptor(d.name);if(!d)return false;}else if(!Registries.ITEMS.containsKey(new Resource(d.id)))return false;
    var key=JSON.stringify(d);if(stackCache[key])return stackCache[key];
    var root=new Tag();root.putString('id',d.id);root.putByte('Count',1);
    if(d.nbt){var tag=new Tag();for(var k in d.nbt)tag.putString(k,String(d.nbt[k]));root.put('tag',tag);}
    var s=Stack.of(root);stackCache[key]=s;return s;
  }
  function begin(screen){if(lastScreen!==screen){painters={};lastScreen=screen;}clicks=[];}
  function paint(g,s,row,x,y,event){
    var offset=0;
    for(var i=0;i<row.runs.length;i++){
      var r=row.runs[i],xx=Math.floor(x+offset),actualWidth=r.width||0;
      if(r.item){var item=stack(r.item);if(!item){offset+=r.width||0;continue;}var pose=g.pose();pose.pushPose();try{pose.translate(xx,y,0);pose.scale(0.5,0.5,1);g.renderItem(item,0,0);}finally{pose.popPose();}
        if(event&&s.isMouseInRelativeRange(event.getMouseX(),event.getMouseY(),xx-s.bookLeft,y-s.bookTop,8,8))s.setTooltipStack(item);
      }else if(r.text){
        var body=r.text,color=r.color==null?0x263945:r.color,italic=String(r.prefix||'').indexOf('\u00a7o')!==-1;
        body=body.replace(/\$\(playername\)/g,function(){var player=s.getMinecraft().player;return player?String(player.getName().getString()):'玩家';});
        var key=JSON.stringify([body,color,italic]);
        if(!painters[key])painters[key]=component(body,color,italic).getVisualOrderText();
        var sequence=painters[key],measured=measure(s.getMinecraft().font,sequence,body);actualWidth=measured;
        // Exact FormattedCharSequence overload: no wrapping, scaling, reflection or i18n style reset.
        try{s['drawCenteredStringNoShadow(net.minecraft.client.gui.GuiGraphics,net.minecraft.util.FormattedCharSequence,int,int,int)'](g,sequence,xx+Math.floor(measured/2),Math.floor(y),color);}
        catch(e){warn('sequence draw fallback',e);var plain=(italic?'\u00a7o':'')+body,plainWidth=Number(s.getMinecraft().font.width(plain));s.drawCenteredStringNoShadow(g,plain,xx+Math.floor(plainWidth/2),Math.floor(y),color);actualWidth=plainWidth;}
        if(event&&(r.command||r.link))clicks.push({screen:s,x:xx,y:y,w:actualWidth,h:11,command:r.command,link:r.link});
      }offset+=actualWidth;
    }
  }
  global.kjsGuideLayoutVersion='1.7.8';
  console.info('[guide layout] 1.7.8 direct text; measured spacing; final-only preview');
  global.kjsGuideRichRowsV1=layout;
  global.kjsGuideRichPaintV1=paint;
  global.kjsGuideRichBeginV1=begin;
  global.kjsGuideRichLineV1=function(g,s,value,x,y,width,color,event,skip){var a=layout(value,width,color,skip);for(var i=0;i<a.length;i++)paint(g,s,a[i],x,y+i*11,event);return a.length;};
  ForgeEvents.onEvent('vazkii.patchouli.api.BookDrawScreenEvent',function(event){try{
    var s=event.getScreen();if(!(s instanceof Entry)||!s.book||String(s.book.id)!=='patchouli:server_rules')return;
    begin(s);var entries=global.kjsGuideRichPagesV1||{},pages=entries[String(s.getEntry().getId())];if(!pages)return;
    for(var side=0;side<2;side++){var page=pages[Number(s.getSpread())*2+side];if(!page)continue;
      for(var b=0;b<page.length;b++){var block=page[b];for(var n=0;n<block.rows.length;n++)paint(event.getGraphics(),s,block.rows[n],s.bookLeft+(side?141:15)+block.x,s.bookTop+18+block.y+n*11,event);}
    }
  }catch(e){warn('draw',e);}});
  ForgeEvents.onEvent('net.minecraftforge.client.event.ScreenEvent$MouseButtonPressed$Pre',function(event){if(event.getButton()!==0)return;try{
    var s=event.getScreen();if(!lastScreen||!lastScreen.equals(s)||!clicks.length)return;var mc=s.getMinecraft(),window=mc.getWindow();
    var before=window.calculateScale(Number(mc.options.guiScale().get()),mc.isEnforceUnicode()),setting=Math.min(Number(Persistent.data.bookGuiScale),Number(s.maxScale)),after=window.calculateScale(setting,mc.isEnforceUnicode());
    var scale=setting>0&&before!==after?after/window.getGuiScale():1,x=event.getMouseX()/scale,y=event.getMouseY()/scale;
    for(var i=0;i<clicks.length;i++){var h=clicks[i];if(h.screen!==s||x<h.x||x>=h.x+h.w||y<h.y||y>=h.y+h.h)continue;
      if(h.command){if(mc.player==null)return;mc.player.connection.sendCommand(h.command.replace(/^\//,''));mc.setScreen(null);}
      else if(/^https?:\/\//.test(h.link))s.handleComponentClicked(Text.of({text:h.link,bold:false,color:'#6b4897',italic:false,underlined:false}).clickOpenUrl(h.link).getStyle());
      else s.navigateToEntry(new Resource(h.link.split('#')[0]),0,true);
      event.setCanceled(true);return;
    }
  }catch(e){warn('click',e);}});
})();
