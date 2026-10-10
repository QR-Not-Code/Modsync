(function () {
  var CompoundTag = Java.loadClass('net.minecraft.nbt.CompoundTag');
  var handshakeId = '';
  ClientEvents.tick(function (event) {
    var player = event.getPlayer();
    if (player == null) {
      handshakeId = '';
      global.kjsPmenuStateCacheV1 = false;
      global.kjsPmenuDetailsCacheV1 = false;
      global.kjsPmenuBooksCacheV1 = false;
      return;
    }
    var id = String(player.getUuid());
    if (handshakeId === id) return;
    handshakeId = id;
    var tag = new CompoundTag(); tag.putInt('details_ui', 1);
    player.sendData('kjs_pmenu_request_v1', tag);
  });
  function receive(event, details) {
    try {
      var tag = event.getData(), player = event.getPlayer();
      if (tag == null || player == null) return;
      var data = JSON.parse(String(tag.getString('payload')));
      if (data.schema !== 1 || data.uuid !== String(player.getUuid()) || typeof data.text !== 'string' || data.text.length > 1000000) return;
      data.receivedAt = Date.now();
      if (details) {
        data.preview = tag.contains('preview', 10) ? tag.getCompound('preview').copy() : null;
        global.kjsPmenuDetailsCacheV1 = data;
        if (data.open && typeof global.kjsPmenuOpenDetailsV1 === 'function') global.kjsPmenuOpenDetailsV1(data.volume);
      } else global.kjsPmenuStateCacheV1 = data;
    } catch (error) { console.error('[pmenu data] ' + error); }
  }
  NetworkEvents.dataReceived('kjs_pmenu_state_v1', function (event) { receive(event, false); });
  NetworkEvents.dataReceived('kjs_pmenu_details_v1', function (event) { receive(event, true); });
  NetworkEvents.dataReceived('kjs_pmenu_books_v1', function (event) {
    try {
      var tag=event.getData(), player=event.getPlayer();
      if (tag==null || player==null) return;
      var encoded=String(tag.getString('payload'));
      if (encoded.length>1000000) return;
      var data=JSON.parse(encoded);
      if (data.schema!==1 || data.uuid!==String(player.getUuid()) || !Array.isArray(data.books) || data.books.length>4096) return;
      for (var i=0;i<data.books.length;i++) if (typeof data.books[i].id!=='string' || typeof data.books[i].name!=='string') return;
      data.receivedAt=Date.now();
      global.kjsPmenuBooksCacheV1=data;
    } catch(error) { console.error('[pmenu books] '+error); }
  });
  NetworkEvents.dataReceived('kjs_pmenu_select_ui_v1',function(event){
    var player=event.getPlayer(),data=event.getData();
    if(player==null||data==null||String(data.getString('uuid'))!==String(player.getUuid()))return;
    var Minecraft=Java.loadClass('net.minecraft.client.Minecraft');
    var ChatScreen=Java.loadClass('net.minecraft.client.gui.screens.ChatScreen');
    var mc=Minecraft.getInstance(),screen=mc.screen;
    if(screen==null||screen instanceof ChatScreen||(screen.book!=null&&String(screen.book.id)==='patchouli:server_rules'))mc.setScreen(new ChatScreen(''));
  });
})();
