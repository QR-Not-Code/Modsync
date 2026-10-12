// Dedicated servers must never resolve these client-only classes.
if (Platform.isClientEnvironment() && Platform.isLoaded('patchouli')) {
  (function () {
    var Entry = Java.loadClass('vazkii.patchouli.client.book.gui.GuiBookEntry');
    var Landing = Java.loadClass('vazkii.patchouli.client.book.gui.GuiBookLanding');
    var Category = Java.loadClass('vazkii.patchouli.client.book.gui.GuiBookCategory');
    var OriginalEntryButton = Java.loadClass('vazkii.patchouli.client.book.gui.button.GuiButtonEntry');
    var EditBox = Java.loadClass('net.minecraft.client.gui.components.EditBox');
    var Button = Java.loadClass('net.minecraft.client.gui.components.Button');
    var Tooltip = Java.loadClass('net.minecraft.client.gui.components.Tooltip');
    var InventoryScreen = Java.loadClass('net.minecraft.client.gui.screens.inventory.InventoryScreen');
    var Component = Java.loadClass('net.minecraft.network.chat.Component');
    var CompoundTag = Java.loadClass('net.minecraft.nbt.CompoundTag');
    var ItemStack = Java.loadClass('net.minecraft.world.item.ItemStack');
    var ResourceLocation = Java.loadClass('net.minecraft.resources.ResourceLocation');
    var Registry = Java.loadClass('vazkii.patchouli.common.book.BookRegistry');
    var Minecraft = Java.loadClass('net.minecraft.client.Minecraft');
    var PersistentData = Java.loadClass('vazkii.patchouli.client.base.PersistentData');
    var context = null, lastRequest = -1, lastView = '', warned = {};
    // Rhino 2001.2.3-build.10 wraps global as a Java Map. A stored null throws
    // from ValueUnwrapper before JS can test it; false is our empty-cache marker.
    global.kjsPmenuDetailStartV1 = -1;
    global.kjsPmenuStateCacheV1 = false;
    global.kjsPmenuDetailsCacheV1 = false;
    global.kjsPmenuBooksCacheV1 = false;

    function norm(value) { return typeof global.kjsGuidePunctuationV1 === 'function' ? global.kjsGuidePunctuationV1(value) : String(value); }
    function kind(screen) {
      if (screen == null || screen.book == null || String(screen.book.id) !== 'patchouli:server_rules') return '';
      if (screen instanceof Landing) return 'home';
      var title = String(screen.getTitle().getString());
      if (screen instanceof Category && title === '其他手册') return 'books';
      if (screen instanceof Entry && title === '我的实时状态') return 'state';
      if (screen instanceof Entry && title === '我的物品明细') return 'details';
      if (screen instanceof Entry && title === '服务器手册目录') return 'books';
      return '';
    }
    function warn(where, error) {
      if (!warned[where]) { warned[where] = true; console.error('[pmenu ' + where + '] ' + error); }
    }
    function cacheFresh(data, player, ttl) {
      var now = Date.now();
      return data != null && typeof data === 'object' && data.uuid === String(player.getUuid()) && now >= data.receivedAt && now - data.receivedAt <= ttl;
    }
    function request(player, view) {
      var now = Date.now(), interval = view === 'books' ? 5000 : 1000;
      if (lastView === view && lastRequest >= 0 && now >= lastRequest && now - lastRequest < interval) return;
      lastView = view; lastRequest = now;
      var tag = new CompoundTag(); tag.putInt('details_ui', 1); tag.putString('view', view);
      player.sendData('kjs_pmenu_request_v1', tag);
    }

    // Font.split returns already-wrapped FormattedCharSequence rows. Draw those rows
    // directly; never feed a pre-wrapped row back into drawWordWrap.
    function fixedDraw(graphics, font, row, x, y, color) {
      if(context==null)throw new Error('Missing book drawing context');
      var offset=0;
      // Only JavaScript strings cross overloaded Font/GuiBook methods.
      // RGB remains the exact original value; vanilla section codes carry
      // italic/underline. Never pass a Java rich-text object to width/drawing.
      for(var r=0;r<row.runs.length;r++) {
        var run=row.runs[r],value=run.prefix+run.text;
        var width=run.width==null?Number(font.width(value)):run.width;
        if(typeof global.kjsGuideRichPaintV1==='function')global.kjsGuideRichPaintV1(graphics,context.screen,{runs:[run]},Math.floor(x+offset),Math.floor(y),null);
        else context.screen.drawCenteredStringNoShadow(graphics,value,Math.floor(x+offset)+Math.floor(width/2),Math.floor(y),run.color==null?color:run.color);
        if(run.command)context.hits.push({x:x+offset,y:y,w:width,h:11,command:run.command});
        offset+=width;
      }
    }
    function displayComponent(value) {
      var text=norm(value).replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'');
      var rgb=0x263945, italic=false;
      if (/^(阶位|最高强度|合计|计入的最高)/.test(text)) { rgb=0x875b20; italic=true; }
      else if (/^(玩家输出|时间倍率|累计在线|每项|\d+\. )/.test(text)) { rgb=0x246d91; italic=true; }
      else if (/^(击杀|职业|种族|自动晋阶)/.test(text)) rgb=0x347750;
      else if (/(警告|降阶|清除|不可|不返还)/.test(text)) { rgb=0xa04a38; italic=true; }
      else if (/正在读取|属性不完整|非旧属性/.test(text)) rgb=0x786954;
      if (/记录时属性|当前匹配物品|基础图标/.test(text)) italic=true;
      // Text.of converts the color and booleans inside compiled KubeJS Java.
      // Never call Style.withColor from Rhino: remapped overloads are ambiguous.
      var component=Text.of({text:text,font:'minecraft:uniform',color:'#'+('000000'+rgb.toString(16)).slice(-6),bold:false,italic:italic});
      var pattern=/\/(?:state(?: (?:details|detail|re|class|race))?|trace(?: (?:items|lock|list|cancel))?|advtrace|claim)(?![a-zA-Z_])/g;
      var result=Component.literal(''),at=0,match;
      while((match=pattern.exec(text))!==null) {
        result.append(Component.literal(text.substring(at,match.index)).setStyle(component.getStyle()));
        var command=match[0];if(command==='/trace items')command='/pmenu choose items';if(command==='/trace lock')command='/pmenu choose lock';
        result.append(Text.of({text:match[0],color:'#6b4897',bold:false,italic:true,underlined:false}).clickRunCommand(command));
        at=match.index+match[0].length;
      }
      result.append(Component.literal(text.substring(at)).setStyle(component.getStyle()));
      return result;
    }
    function fontRows(font, value, width, overrideColor) {
      if(typeof global.kjsGuideRichRowsV1==='function'){
        var raw=norm(value),rgb=overrideColor||0x263945;
        if(!overrideColor&&/^(阶位|最高强度|合计|计入的最高)/.test(raw))rgb=0x875b20;
        else if(!overrideColor&&/^(玩家输出|时间倍率|累计在线|每项|\d+\. )/.test(raw))rgb=0x246d91;
        else if(!overrideColor&&/^(击杀|职业|种族|自动晋阶)/.test(raw))rgb=0x347750;
        else if(!overrideColor&&/(警告|降阶|清除|不可|不返还)/.test(raw))rgb=0xa04a38;
        else if(!overrideColor&&/正在读取|属性不完整|非旧属性/.test(raw))rgb=0x786954;
        if(overrideColor||/^(阶位|最高强度|合计|计入的最高|玩家输出|时间倍率|累计在线|每项|\d+\. )/.test(raw)||/(警告|降阶|清除|记录时属性|当前匹配物品|基础图标)/.test(raw))raw='$(o)'+raw;
        raw=raw.replace(/\/(?:state(?: (?:details|detail|re|class|race))?|trace(?: (?:items|lock|list|cancel))?|advtrace|claim)(?![a-zA-Z_])/g,function(cmd){var send=cmd;if(cmd==='/trace items')send='/pmenu choose items';if(cmd==='/trace lock')send='/pmenu choose lock';return '$(c:'+send+')$(#6b4897)$(o)'+cmd+'$(/c)$()';});
        return global.kjsGuideRichRowsV1(raw,width,rgb,context&&context.view==='details'?{all:true}:{});
      }
      var javaRows=font.split(overrideColor==null?displayComponent(value):Text.of({text:norm(value),color:'#'+('000000'+overrideColor.toString(16)).slice(-6),italic:true,bold:false,underlined:false}),width),rows=[];
      for(var i=0;i<javaRows.size();i++) {
        var runs=[];
        javaRows.get(i).accept(function(index,style,code){
          var chars=code<=65535?String.fromCharCode(code):String.fromCharCode(0xd800+((code-65536)>>10),0xdc00+((code-65536)&1023));
          var color=style.getColor(),rgb=color==null?null:Number(color.getValue());
          var prefix=(style.isItalic()?'\u00a7o':'');
          var click=style.getClickEvent(),command=click!=null&&String(click.getAction())==='RUN_COMMAND'?String(click.getValue()):'';
          var previous=runs.length?runs[runs.length-1]:null;
          if(previous!=null&&previous.color===rgb&&previous.prefix===prefix&&previous.command===command)previous.text+=chars;
          else runs.push({text:chars,color:rgb,prefix:prefix,command:command});
          return true;
        });
        rows.push({runs:runs});
      }
      return rows;
    }
    function drawRows(graphics,font,rows,x,y,limit,color) {
      var spacing=Math.max(11,Number(font.lineHeight||9)+2);
      for(var i=0;i<rows.length&&i<limit;i++)fixedDraw(graphics,font,rows[i],x,y+i*spacing,color);
    }
    ForgeEvents.onEvent('net.minecraftforge.client.event.ScreenEvent$MouseButtonPressed$Pre',function(event){
      if(context==null||event.getButton()!==0||!context.screen.equals(event.getScreen()))return;
      try{
        var mc=context.screen.getMinecraft(),res=mc.getWindow();
        var oldScale=res.calculateScale(Number(mc.options.guiScale().get()),mc.isEnforceUnicode());
        var persistent=Math.min(Number(PersistentData.data.bookGuiScale),Number(context.screen.maxScale));
        var newScale=res.calculateScale(persistent,mc.isEnforceUnicode());
        var factor=persistent>0&&newScale!==oldScale?newScale/res.getGuiScale():1;
        var mx=event.getMouseX()/factor,my=event.getMouseY()/factor;
        for(var i=0;i<context.hits.length;i++){
          var hit=context.hits[i];if(mx<hit.x||mx>=hit.x+hit.w||my<hit.y||my>=hit.y+hit.h)continue;
          if(mc.player==null)return;
          if(hit.enchantment){event.setCanceled(true);global.kjsPmenuOpenEnchantmentV1(hit.enchantment);return;}
          event.setCanceled(true);mc.setScreen(null);
          mc.player.connection.sendCommand(hit.command.substring(1));return;
        }
      }catch(error){warn('command click',error);}
    });
    function title(graphics, font, value, x, y) { drawRows(graphics,font,fontRows(font,value,108),x,y,1,0x183a50); }
    function pagesFor(font, blocks, capacity) {
      var pages = [], page = [];
      for (var i = 0; i < blocks.length; i++) {
        var rows = fontRows(font,blocks[i],108);
        if (rows.length <= capacity && page.length > 0 && page.length + rows.length > capacity) { pages.push(page); page = []; }
        for (var j = 0; j < rows.length; j++) {
          if (page.length >= capacity) { pages.push(page); page = []; }
          page.push(rows[j]);
        }
      }
      if (page.length > 0 || pages.length === 0) pages.push(page);
      return pages;
    }
    function number(value) { return String(Math.round(Number(value) * 100) / 100); }

    function addButton(ctx, label, x, y, width, onClick) {
      var button = Button.builder(Component.literal(label),function () { onClick(); })
        .bounds(ctx.screen.bookLeft+x,ctx.screen.bookTop+y,width,14).build();
      ctx.init.addListener(button);
      return button;
    }
    function pageButtons(ctx) {
      ctx.previous = addButton(ctx,'<',141,155,50,function () { ctx.page = Math.max(0,ctx.page-1); });
      ctx.next = addButton(ctx,'>',199,155,50,function () { ctx.page = Math.min(Math.max(0,ctx.count-1),ctx.page+1); });
    }

    ForgeEvents.onEvent('net.minecraftforge.client.event.ScreenEvent$Init$Post',function (event) {
      context = null;
      try {
        var screen = event.getScreen(), view = kind(screen);
        if (view !== 'state' && view !== 'details' && view !== 'books') return;
        var ctx = {screen:screen,init:event,view:view,page:0,count:1,key:'',pages:[],previewKey:'',preview:null,bookButtons:[],hits:[]};
        context = ctx;
        if (view === 'details' && Number(global.kjsPmenuDetailStartV1) >= 0) {
          ctx.page = Math.max(0, Math.floor(Number(global.kjsPmenuDetailStartV1))); global.kjsPmenuDetailStartV1 = -1;
        }
        if (view === 'books') {
          var old = event.getListenersList().iterator(), remove = [];
          while (old.hasNext()) {
            var widget = old.next();
            if (widget instanceof OriginalEntryButton || widget instanceof EditBox) remove.push(widget);
          }
          for (var i = 0; i < remove.length; i++) {
            remove[i].visible = false; remove[i].active = false;
            if (remove[i] instanceof EditBox) remove[i].setFocused(false);
            event.removeListener(remove[i]);
          }
          for (var b = 0; b < 8; b++) (function (index) {
            var button = addButton(ctx,'...',141,42+index*14,108,function () {
              var record = ctx.books == null ? null : ctx.books[ctx.page*8+index];
              if (record != null) openOther(record.id);
            });
            button.visible = false; ctx.bookButtons.push(button);
          })(b);
        }
        if (view === 'state') addButton(ctx,'查看明细',15,155,108,function () { global.kjsPmenuOpenDetailsV1(1); });
        pageButtons(ctx);
      } catch (error) { warn('init',error); }
    });

    function localBook(id) { return Registry.INSTANCE.books.get(new ResourceLocation(id)); }
    function openOther(id) {
      var mc = Minecraft.getInstance(), data = global.kjsPmenuBooksCacheV1;
      if (mc.player == null || !cacheFresh(data,mc.player,30000)) return;
      var allowed = false;
      for (var i=0;i<data.books.length;i++) if (data.books[i].id===id) allowed=true;
      if (!allowed || id==='patchouli:server_rules') return;
      var book = localBook(id);
      if (book == null) { mc.player.tell(Component.literal('客户端缺少该手册的模组或资源.')); return; }
      // Replace the current guide screen. No item is granted or inserted into inventory.
      book.getContents().guiStack.clear();
      mc.setScreen(new Landing(book));
    }
    global.kjsPmenuOpenDetailsV1 = function (volume) {
      var book = localBook('patchouli:server_rules');
      if (book == null) return;
      var entry = book.getContents().entries.get(new ResourceLocation('patchouli:personal/details'));
      if (entry == null) { warn('details','Missing guide v1.5 detail entry'); return; }
      // Legacy volume parameter advances approximately 90 old text pages.
      global.kjsPmenuDetailStartV1 = Math.max(0, ((Number(volume)||1)-1)*90);
      Minecraft.getInstance().setScreen(new Entry(book,entry,0));
    };

    function drawState(event,screen,ctx) {
      var mc=screen.getMinecraft(), player=mc.player;
      if (player==null) return;
      request(player,'');
      var data=global.kjsPmenuStateCacheV1;
      var body=cacheFresh(data,player,5000)?data.text:'正在读取服务器状态...';
      if (ctx.key!==body) { ctx.key=body; ctx.pages=pagesFor(mc.font,String(body).split('\n'),9); }
      ctx.count=Math.max(1,Math.ceil(ctx.pages.length/2)); ctx.page=Math.min(ctx.page,ctx.count-1);
      var g=event.getGraphics(),x=screen.bookLeft,y=screen.bookTop;
      title(g,mc.font,'个人状态 '+(ctx.page+1)+'/'+ctx.count,x+141,y+18);
      drawRows(g,mc.font,ctx.pages[ctx.page*2]||[],x+15,y+42,9,0x263945);
      drawRows(g,mc.font,ctx.pages[ctx.page*2+1]||[],x+141,y+42,9,0x263945);
    }

    function drawDetails(event,screen,ctx) {
      var mc=screen.getMinecraft(), player=mc.player;
      if (player==null) return;
      request(player,'details');
      var data=global.kjsPmenuDetailsCacheV1, fresh=cacheFresh(data,player,5000), meta=fresh?data.details:null;
      var key=fresh?String(data.recordKey):'waiting';
      if (ctx.key!==key) {
        if (ctx.key!=='' && key!=='waiting') ctx.page=0;
        ctx.key=key;
        var blocks=[];
        ctx.enchantments=meta!=null&&meta.enchantments!=null?meta.enchantments:null;
        if(ctx.enchantments==null){blocks=[fresh?data.text:'正在读取物品明细...'];ctx.pages=pagesFor(mc.font,blocks,9);}
        else ctx.pages=[];
        ctx.preview=null;
        if (fresh && data.preview!=null) { try { ctx.preview=ItemStack.of(data.preview.copy()); } catch(error) { warn('preview',error); } }
      }
      ctx.count=ctx.enchantments!=null?Math.max(1,Math.ceil(ctx.enchantments.length/3)):ctx.pages.length; ctx.page=Math.min(ctx.page,Math.max(0,ctx.count-1));
      var g=event.getGraphics(),x=screen.bookLeft,y=screen.bookTop;
      title(g,mc.font,'附魔贡献 '+(ctx.page+1)+'/'+ctx.count,x+141,y+18);
      if(ctx.enchantments!=null){
        for(var j=0;j<3;j++){
          var row=ctx.enchantments[ctx.page*3+j];if(row==null)break;
          var yy=y+42+j*36,id=String(row.id||'');
          var stack=global.kjsPmenuEnchantmentBookV1(id,row.level);
          g.fill(x+140,yy+2,x+158,yy+20,-1515819);g.renderItem(stack,x+141,yy+3);
          if(screen.isMouseInRelativeRange(event.getMouseX(),event.getMouseY(),140,yy-y+2,18,18))screen.setTooltipStack(stack);
          var name=fontRows(mc.font,(ctx.page*3+j+1)+'. '+row.name+' '+row.level+'级',84,0x6b4897);
          drawRows(g,mc.font,name,x+163,yy,2,0x6b4897);
          drawRows(g,mc.font,fontRows(mc.font,number(row.level)+' * '+number(row.weight)+' = '+number(row.contribution),108),x+141,yy+23,1,0x263945);
          ctx.hits.push({x:x+140,y:yy,w:108,h:22,enchantment:id});
        }
      }else drawRows(g,mc.font,ctx.pages[ctx.page]||[],x+141,y+42,9,0x263945);
      if (fresh && ctx.preview!=null && !ctx.preview.isEmpty()) {
        g.fill(x+59,y+35,x+77,y+53,-1515819);g.renderItem(ctx.preview,x+60,y+36);g.renderItemDecorations(mc.font,ctx.preview,x+60,y+36);
        if (screen.isMouseInRelativeRange(event.getMouseX(),event.getMouseY(),59,35,18,18)) screen.setTooltipStack(ctx.preview);
      }
      // Left page is stable metadata only; enchantment contributions appear once, on the right.
      if (meta!=null) {
        var left=[];
        var name=fontRows(mc.font,meta.itemName,108); for(var n=0;n<name.length&&n<2;n++)left.push(name[n]);
        left=left.concat(fontRows(mc.font,mc.font.plainSubstrByWidth(String(meta.itemId),98),108));
        left=left.concat(fontRows(mc.font,'最高强度: '+number(meta.total),108));
        left=left.concat(fontRows(mc.font,mc.font.plainSubstrByWidth(norm(meta.location||''),98),108));
        var note=data.previewStatus==='full'?'当前物品属性快照.':data.previewStatus==='matched_current'?'当前最高强度物品.':'基础图标, 当前属性不完整.';
        left=left.concat(fontRows(mc.font,note,108));
        drawRows(g,mc.font,left,x+15,y+64,7,0x263945);
      }
    }

    function drawBooks(event,screen,ctx) {
      var mc=screen.getMinecraft(),player=mc.player;
      if (player==null)return;
      request(player,'books');
      var data=global.kjsPmenuBooksCacheV1, fresh=cacheFresh(data,player,30000);
      ctx.books=fresh?data.books:[];ctx.count=Math.max(1,Math.ceil(ctx.books.length/8));ctx.page=Math.min(ctx.page,ctx.count-1);
      for(var i=0;i<8;i++) {
        var record=ctx.books[ctx.page*8+i],button=ctx.bookButtons[i];
        button.visible=record!=null;
        if(record!=null) {
          var local=localBook(record.id),name=record.name;
          if(local!=null) { try { name=String(local.getBookItem().getHoverName().getString()); } catch(ignored){} }
          name=norm(name);
          button.active=local!=null;
          button.setMessage(Component.literal(mc.font.plainSubstrByWidth(name,98)));
          button.setTooltip(Tooltip.create(Component.literal(name+'\n'+record.id+(local==null?'\n客户端缺少手册资源.':''))));
        }
      }
      if(!fresh||ctx.books.length===0) drawRows(event.getGraphics(),mc.font,fontRows(mc.font,fresh?'没有其他已注册手册.':'正在读取服务器手册...',108),screen.bookLeft+141,screen.bookTop+42,3,0x263945);
      title(event.getGraphics(),mc.font,(ctx.page+1)+'/'+ctx.count,screen.bookLeft+199,screen.bookTop+140);
    }

    ForgeEvents.onEvent('vazkii.patchouli.api.BookDrawScreenEvent',function(event){
      var view = 'draw';
      try {
        if(String(event.getBook())!=='patchouli:server_rules')return;
        var screen=event.getScreen(); view=kind(screen);
        if(view==='home') {
          var mc=screen.getMinecraft();
          if(mc.player!=null)InventoryScreen.renderEntityInInventoryFollowsMouse(event.getGraphics(),screen.bookLeft+73,screen.bookTop+146,42,
            (screen.bookLeft+73-event.getMouseX())/2,(screen.bookTop+100-event.getMouseY())/2,mc.player);
          return;
        }
        if(context==null||!context.screen.equals(screen)||context.view!==view)return;
        context.hits=[];
        if(view==='state')drawState(event,screen,context);
        else if(view==='details')drawDetails(event,screen,context);
        else if(view==='books')drawBooks(event,screen,context);
        if(context.previous!=null){context.previous.active=context.page>0;context.next.active=context.page+1<context.count;}
      }catch(error){warn(view,error);}
    });
  })();
}
