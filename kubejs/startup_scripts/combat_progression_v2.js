// Minecraft 1.20.1 Forge / KubeJS 2001.6.5. Revision 2.12 (current inventory strength, live promotion/demotion)
// 放入服务器 kubejs/startup_scripts/，完整重启。
// 必须停用旧 enchantment_scaling.js、03_hostile_health_x5.js 等战斗脚本。
// 玩家受伤倍率及生物暴击在LivingHurtEvent处理，先于原版护甲/抗性/吸收。
// 玩家输出按阶级在LivingDamageEvent处理；取消原来的固定1/20。
(function () {
  var MinecraftForge = Java.loadClass('net.minecraftforge.common.MinecraftForge');
  var EventPriority = Java.loadClass('net.minecraftforge.eventbus.api.EventPriority');
  var LivingHurtEvent = Java.loadClass('net.minecraftforge.event.entity.living.LivingHurtEvent');
  var LivingDropsEvent = Java.loadClass('net.minecraftforge.event.entity.living.LivingDropsEvent');
  var ItemEntity = Java.loadClass('net.minecraft.world.entity.item.ItemEntity');
  var ArmorStand = Java.loadClass('net.minecraft.world.entity.decoration.ArmorStand');
  var AttributeModifier = Java.loadClass('net.minecraft.world.entity.ai.attributes.AttributeModifier');
  var Operation = Java.loadClass('net.minecraft.world.entity.ai.attributes.AttributeModifier$Operation');
  var CompoundTag = Java.loadClass('net.minecraft.nbt.CompoundTag');
  var ResourceLocation = Java.loadClass('net.minecraft.resources.ResourceLocation');
  var Living = Java.loadClass('net.minecraft.world.entity.LivingEntity');
  var Player = Java.loadClass('net.minecraft.world.entity.player.Player');
  var Projectile = Java.loadClass('net.minecraft.world.entity.projectile.Projectile');
  var Cloud = Java.loadClass('net.minecraft.world.entity.AreaEffectCloud');
  var Attributes = Java.loadClass('net.minecraft.world.entity.ai.attributes.Attributes');
  var UUID = Java.loadClass('java.util.UUID');
  var Random = Java.loadClass('java.util.concurrent.ThreadLocalRandom');
  var Commands = Java.loadClass('net.minecraft.commands.Commands');
  var EntityArgument = Java.loadClass('net.minecraft.commands.arguments.EntityArgument');
  var DoubleArgument = Java.loadClass('com.mojang.brigadier.arguments.DoubleArgumentType');
  var Component = Java.loadClass('net.minecraft.network.chat.Component');
  var SetSlotPacket = Java.loadClass('net.minecraft.network.protocol.game.ClientboundContainerSetSlotPacket');
  var OpenBookPacket = Java.loadClass('net.minecraft.network.protocol.game.ClientboundOpenBookPacket');
  var BundlePacket = Java.loadClass('net.minecraft.network.protocol.game.ClientboundBundlePacket');
  var InteractionHand = Java.loadClass('net.minecraft.world.InteractionHand');
  var ArrayList = Java.loadClass('java.util.ArrayList');
  var IntArg = Java.loadClass('com.mojang.brigadier.arguments.IntegerArgumentType');

  var RANK_NAMES = ['1阶', '2阶', '3阶', '4阶', '5阶'];
  var OUTGOING = [1, 1 / 3, 1 / 25, 1 / 75, 1 / 200];
  var CHANCE = [0, 0.016, 0.10, 0.20, 0.50];
  var CHANCE_TEXT = ['0%', '1.6%', '10%', '20%', '50%'];
  var XP_BONUS_UNITS = [0, 1, 2, 3, 5]; // fifths: +0%,20%,40%,60%,100%
  var XP_BONUS_TEXT = ['0%', '20%', '40%', '60%', '100%'];
  var XP_REMAINDER_KEY = 'kjs_kill_xp_fifths_v1';
  var THRESHOLDS = [0, 20, 80, 200, 400]; // 达到门槛；内部rank为0..4，显示阶位为1..5。
  var RANK_KEY = 'kjs_progression_v2';
  var CRYSTAL_ID = 'legendblade:soul_crystal';
  var CLASS_LAYER = 'origins-classes:class';
  var RACE_LAYER = 'origins:origin';
  var HEALTH_ID = UUID.fromString('c4e1baa7-fc18-47dc-8367-7d9a5d8e1b92');
  var liveRecords = {};
  var scanWarnings = {};
  var crystalWarning = false;
  var OriginsAPI = null;
  var OriginContainer = null;
  if (Platform.isLoaded('origins')) {
    try {
      OriginsAPI = Java.loadClass('io.github.edwinmindcraft.origins.api.OriginsAPI');
      OriginContainer = Java.loadClass('io.github.edwinmindcraft.origins.api.capabilities.IOriginContainer');
    } catch (error) {
      console.warn('[progression] Origins Forge适配不可用；等级和重选次数仍会保存：' + error);
    }
  }

  var PLAYER_INCOMING = 1;
  var MAX_NORMAL_INCOMING = 4; // 普通受伤上限；生物暴击为此值的2倍。
  var CAP_HOURS = 100;
  var CRIT_MULTIPLIER = 2;
  var CRIT_DENOMINATOR = 4; // nextInt(4) == 0：独立的 1/4 概率。
  var OLD_HEALTH_ID = UUID.fromString('ab52a15c-4e95-45eb-91fd-28e9d344bc30');

  // 每个玩家从本版本安装后累计在线的现实毫秒数；离线不累计。
  var TIME_KEY = 'kjs_combat_online_ms_v1';
  var DAY_MS = 86400000;
  var HOUR_MS = 3600000;
  var sessionClock = {};

  function nowMs() {
    // JavaScript 内置时钟，无需访问被 KubeJS 禁止的 java.lang.System。
    // 现实毫秒，不依赖TPS；系统时钟回拨时由updateTime排除负增量。
    // 时间戳仅存内存，跨重启只保留累计时长，离线不累计。
    return Date.now();
  }

  function storedTime(player) {
    var value = Number(player.getPersistentData().getDouble(TIME_KEY));
    return isFinite(value) && value > 0 ? value : 0;
  }

  function updateTime(player) {
    var id = String(player.getUuid());
    var now = nowMs();
    var total = storedTime(player);
    if (sessionClock[id] != null) {
      total += Math.max(0, now - sessionClock[id]);
    }
    sessionClock[id] = now;
    player.getPersistentData().putDouble(TIME_KEY, total);
    return total;
  }

  function multiplierAt(elapsedMs) {
    // 从0小时开始增长，100小时达到4倍并封顶。
    // 轻微减速：增长速度从每小时0.033倍降到封顶前0.027倍。
    var hours = Math.max(0, elapsedMs / HOUR_MS);
    var x = Math.max(0, Math.min(1, hours / CAP_HOURS));
    var progress = x + 0.1 * x * (1 - x);
    return 1 + (MAX_NORMAL_INCOMING / PLAYER_INCOMING - 1) * progress;
  }

  function timeMultiplier(player) {
    return multiplierAt(updateTime(player));
  }

  function setHours(player, hours) {
    player.getPersistentData().putDouble(TIME_KEY, hours * HOUR_MS);
    // 同步重置本次计时起点，防止旧会话增量在下一tick重新加回来。
    sessionClock[String(player.getUuid())] = nowMs();
  }

  function rankData(player) {
    var root = player.getPersistentData();
    if (!root.contains(RANK_KEY, 10)) root.put(RANK_KEY, new CompoundTag());
    var d = root.getCompound(RANK_KEY);
    // 独立记录已发放晋阶奖励的最高阶位，避免实时降阶再晋阶反复刷次数。
    // 迁移时按现有阶位初始化，不重发已取得阶位的奖励。
    if (!d.contains('rewardedRank_v1', 3)) {
      d.putInt('rewardedRank_v1', Math.max(0, Math.min(4, d.getInt('rank'))));
    }
    return d;
  }

  function rankOf(player) {
    return Math.max(0, Math.min(4, rankData(player).getInt('rank')));
  }

  function rankFor(total) {
    for (var rank = 4; rank > 0; rank--) if (total >= THRESHOLDS[rank]) return rank;
    return 0;
  }

  function enchantmentTotal(stack) {
    if (typeof global.kjsItemEnchantmentStrengthV1 !== 'function') {
      throw new Error('缺少 startup_scripts/00_enchantment_strengths.js，停止本次评阶检查');
    }
    return global.kjsItemEnchantmentStrengthV1(stack);
  }

  function changeRank(player, target, reason) {
    var d = rankData(player);
    var old = rankOf(player);
    target = Math.max(0, Math.min(4, target));
    if (old === target) return false;
    d.putInt('rank', target);
    if (target > old) {
      var rewarded = Math.max(old, Math.max(0, Math.min(4, d.getInt('rewardedRank_v1'))));
      var credits = Math.max(0, target - rewarded);
      d.putInt('classCredits', Math.min(2147483647, d.getInt('classCredits') + credits));
      if (rewarded < 4 && target === 4) d.putInt('raceCredits', Math.min(2147483647, d.getInt('raceCredits') + 1));
      d.putInt('rewardedRank_v1', Math.max(rewarded, target));
      // tell发送到该玩家聊天窗口；只在等级实际上升时提示，重复扫描不会刷屏。
      player.tell(Component.literal('【阶级晋升】' + RANK_NAMES[old] + ' → ' + RANK_NAMES[target] +
        '\n当前输出倍率：×' + OUTGOING[target] + '；额外魂缚晶掉落概率：' + CHANCE_TEXT[target] +
        (target === 4 ? '\n5阶特权：职业和种族均可无限重选，使用 /state class 或 /state race。' :
          (credits > 0 ? '\n本次获得职业重选：' + credits + ' 次，使用 /state class' : '\n该阶位的晋升奖励已领取，本次不重复发放。')) +
        '\n输入 /state 查看完整阶位效果。'));
    } else if (reason === 'live') {
      player.tell(Component.literal('【实时阶位变化】' + RANK_NAMES[old] + ' → ' + RANK_NAMES[target] +
        '\n当前持有物品的最高附魔强度：' + numberText(d.getDouble('bestStrength_v1')) +
        '\n玩家输出倍率：×' + OUTGOING[old] + ' → ×' + OUTGOING[target] +
        refreshTraceAfterRankChange(player, old)));
    } else {
      player.tell(Component.literal('管理员已将你的等级调整为' + RANK_NAMES[target] + '。'));
    }
    return true;
  }

  function saveItemPreview(d, stack, status, preparedTag) {
    d.remove('bestItemPreview_v1');
    d.putString('previewStatus_v1', 'none');
    d.putDouble('previewStamp_v1', Math.max(nowMs(), d.getDouble('previewStamp_v1') + 1));
    if (stack == null || stack.isEmpty()) return;
    try {
      var tag = preparedTag || stack.toNBT();
      // Bound display data; large backpacks must not flood the network with nested inventory.
      if (String(tag).length > 131072) {
        d.putString('previewStatus_v1', 'too_large');
        return;
      }
      d.put('bestItemPreview_v1', tag.copy());
      d.putString('previewStatus_v1', status || 'full');
    } catch (error) {
      d.putString('previewStatus_v1', 'unavailable');
      console.warn('[progression] 保存物品只读预览失败，分数和物品明细保留：' + error);
    }
  }

  function makeItemDetails(stack, total, location) {
    if (stack == null || stack.isEmpty() || total <= 0) return null;
    var rows = [];
    var entries = stack.getEnchantments().entrySet().iterator();
    while (entries.hasNext()) {
      var entry = entries.next();
      var level = Number(entry.getValue());
      if (!isFinite(level) || level <= 0) continue;
      level = Math.floor(level);
      var id = String(entry.getKey());
      var weight = global.kjsEnchantmentWeightV1(id);
      rows.push({id: id, name: (global.kjsEnchantmentNamesV1 && global.kjsEnchantmentNamesV1[id]) || id,
        level: level, weight: weight, contribution: level * weight});
    }
    rows.sort(function (a, b) {
      if (a.contribution !== b.contribution) return b.contribution - a.contribution;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return {schema: 1, itemId: String(stack.getId()),
      itemName: String(stack.getHoverName().getString()), total: total,
      location: location || '获得物品时', observedAt: nowMs(), enchantments: rows};
  }

  function inventoryBest(player) {
    var inventory = player.getInventory();
    var best = {total: 0, stack: null, location: ''};
    for (var slot = 0; slot < inventory.getSlots(); slot++) {
      var stack = inventory.getStackInSlot(slot);
      var total = enchantmentTotal(stack);
      if (total > best.total) {
        var location = slot < 9 ? '快捷栏第' + (slot + 1) + '格' :
          slot < 36 ? '背包第' + (slot - 8) + '格' :
          slot < 40 ? ['靴子栏', '护腿栏', '胸甲栏', '头盔栏'][slot - 36] :
          slot === 40 ? '副手' : '背包槽位' + slot;
        best = {total: total, stack: stack, location: location};
      }
    }
    var mouse = player.getMouseItem();
    var mouseTotal = enchantmentTotal(mouse);
    if (mouseTotal > best.total) best = {total: mouseTotal, stack: mouse, location: '鼠标上的物品'};
    return best;
  }

  function numberText(value) { return String(Math.round(Number(value) * 100) / 100); }

  function detailLink(text) {
    // KubeJS ComponentKJS handles native Style calls inside Java, avoiding
    // Rhino ambiguity between withColor(ChatFormatting) and withColor(TextColor).
    return Component.literal(String(text)).aqua().underlined().clickRunCommand('/state details');
  }

  function stateComponent(player, elapsed) {
    var text = statusText(player, elapsed);
    var rankName = RANK_NAMES[rankOf(player)];
    var rankStart = text.indexOf(rankName);
    var prefix = '\n当前单件物品最高附魔强度：';
    var valueStart = text.indexOf(prefix) + prefix.length;
    var valueEnd = text.indexOf('\n', valueStart);
    if (valueEnd < 0) valueEnd = text.length;
    return Component.literal(text.substring(0, rankStart))
      .append(detailLink(rankName))
      .append(Component.literal(text.substring(rankStart + rankName.length, valueStart)))
      .append(detailLink(text.substring(valueStart, valueEnd) + '（点击明细）'))
      .append(Component.literal(text.substring(valueEnd)));
  }

  // 原版书页宽114像素；保守按102像素、每页12行切分，长物品名和ID也分页。
  function bookPages(text) {
    var lines = [];
    var raw = String(text).replace(/\u00a7./g, '').split('\n');
    for (var i = 0; i < raw.length; i++) {
      var line = '', width = 0;
      for (var j = 0; j < raw[i].length; j++) {
        var ch = raw[i].charAt(j);
        var step = raw[i].charCodeAt(j) < 128 ? 6 : 10;
        if (width + step > 102 && line.length > 0) { lines.push(line); line = ''; width = 0; }
        line += ch; width += step;
      }
      lines.push(line);
    }
    var pages = [];
    for (var at = 0; at < lines.length; at += 12) pages.push(lines.slice(at, at + 12).join('\n'));
    return pages;
  }

  function detailsSnapshot(player) {
    scanInventory(player);
      var d = rankData(player);
      var score = d.getDouble('bestStrength_v1');
      var data = null;
      var encoded = String(d.getString('bestItemDetails_v1'));
      if (encoded !== '') {
        try { data = JSON.parse(encoded); } catch (error) { data = null; }
      }
      var text = '计入的最高附魔强度\n' + numberText(score) + '分\n当前阶位：' + RANK_NAMES[rankOf(player)] + '\n\n';
      if (score <= 0) {
        text += '当前没有正分附魔物品。\n所有物品类型均检查。';
      } else if (data == null || data.schema !== 1 || Number(data.total) !== score || !data.enchantments) {
        text += '当前检测未能读取完整明细。\n请检查服务器检测日志；下次成功检测后自动更新。';
      } else {
        text += '对应物品：\n' + data.itemName + '\n' + data.itemId +
          '\n当前物品位置：\n' + data.location + '\n\n每项贡献：\n等级 × 单级强度\n\n';
        for (var i = 0; i < data.enchantments.length; i++) {
          var row = data.enchantments[i];
          text += (i + 1) + '. ' + row.name + '\n' + row.id + '\n' +
            numberText(row.level) + ' × ' + numberText(row.weight) + ' = ' + numberText(row.contribution) + '\n\n';
        }
        text += '合计：' + numberText(data.total) + '\n\n这是当前持有的最高强度物品。\n物品丢弃、损坏或更换后，阶位和明细自动更新。';
      }
    var status = String(d.getString('previewStatus_v1'));
    var preview = null;
    var note = '';
    if (score > 0 && data != null && Number(data.total) === score) {
      if (d.contains('bestItemPreview_v1', 10)) {
        preview = d.getCompound('bestItemPreview_v1').copy();
        note = status === 'matched_current' ? '预览取自当前同ID、同名、同附魔物品；旧时耐久等属性无法反推。' : '预览为最近一次实时检测的完整物品快照。';
      } else {
        // A base icon is not represented as a reconstruction of unknown item properties.
        try {
          var base = Item.of(data.itemId, 1);
          if (!base.isEmpty()) preview = base.toNBT();
        } catch (ignored) { preview = null; }
        note = status === 'too_large' ? '物品数据过大，仅展示基础图标；悬浮属性不是完整当前属性。' :
          '当前物品预览数据不可用，仅展示基础图标；属性不完整。';
      }
    }
    if (note !== '') text += '\n\n' + note;
    return {text: text, pages: bookPages(text), preview: preview, previewNote: note, metadata: data != null && Number(data.total) === score ? data : null, previewStatus: status,
      recordKey: String(score) + '/' + (data == null ? '' : String(data.observedAt) + '/' + data.itemId) + '/' + d.getDouble('previewStamp_v1')};
  }

  global.kjsProgressionDetailsV1 = detailsSnapshot;

  function detailsPacket(player, snapshot, volume, open) {
    var packet = new CompoundTag();
    var volumes = Math.max(1, Math.ceil(snapshot.pages.length / 90));
    packet.putString('payload', JSON.stringify({schema: 1, uuid: String(player.getUuid()),
      text: typeof global.kjsGuidePunctuationV1 === "function" ? global.kjsGuidePunctuationV1(snapshot.text) : snapshot.text,
      details: snapshot.metadata, previewStatus: snapshot.previewStatus, recordKey: snapshot.recordKey, previewNote: snapshot.previewNote,
      volume: volume, volumes: volumes, open: open}));
    if (snapshot.preview != null) packet.put('preview', snapshot.preview.copy());
    return packet;
  }

  global.kjsProgressionDetailsPacketV1 = function (player, open, volume) {
    var snapshot = detailsSnapshot(player);
    var count = Math.max(1, Math.ceil(snapshot.pages.length / 90));
    volume = Math.max(1, Math.min(count, Math.floor(Number(volume) || 1)));
    return detailsPacket(player, snapshot, volume, open);
  };

  function openDetails(source, volume) {
    var player = source.getPlayerOrException();
    try {
      scanInventory(player); // 以当前物品更新明细，包括最高物品丢弃后的切换。
      var snapshot = detailsSnapshot(player);
      var text = snapshot.text;
      var allPages = bookPages(text);
      var volumes = Math.max(1, Math.ceil(allPages.length / 90));
      if (volume < 1 || volume > volumes) {
        source.sendFailure(Component.literal('明细共有' + volumes + '册，请选择1到' + volumes + '。'));
        return 0;
      }
      if (typeof global.kjsPmenuDetailsClientV1 === 'function' && global.kjsPmenuDetailsClientV1(player)) {
        player.sendData('kjs_pmenu_details_v1', detailsPacket(player, snapshot, volume, true));
        return 1;
      }
      // Older/unmodified clients retain the original text-book fallback.
      var pages = [];
      var begin = (volume - 1) * 90;
      for (var n = begin; n < Math.min(begin + 90, allPages.length); n++) pages.push(JSON.stringify({text: allPages[n]}));
      if (volumes > 1) {
        var navigation = {text: '第' + volume + '/' + volumes + '册\n\n', extra: []};
        if (volume > 1) navigation.extra.push({text: '上一册\n', color: 'blue', underlined: true,
          clickEvent: {action: 'run_command', value: '/state details ' + (volume - 1)}});
        if (volume < volumes) navigation.extra.push({text: '下一册\n', color: 'blue', underlined: true,
          clickEvent: {action: 'run_command', value: '/state details ' + (volume + 1)}});
        pages.push(JSON.stringify(navigation));
      }
      var book = Item.of('minecraft:written_book', 1,
        {title: '附魔强度明细', author: '服务器', resolved: true, generation: 0, pages: pages});
      var slot = player.getSelectedSlot();
      var held = player.getInventory().getStackInSlot(slot).copy();
      // 仅客户端临时展示书，原服务器物品从未替换；同一bundle按书→打开→恢复顺序处理。
      // BookViewScreen构造时复制书页，恢复手持物品后仍能阅读。
      var packets = new ArrayList();
      packets.add(new SetSlotPacket(-2, 0, slot, book));
      packets.add(new OpenBookPacket(InteractionHand.MAIN_HAND));
      packets.add(new SetSlotPacket(-2, 0, slot, held));
      player.connection.send(new BundlePacket(packets));
      return 1;
    } catch (error) {
      console.error('[progression] 打开强度明细失败：' + error);
      source.sendFailure(Component.literal('无法打开附魔明细，请检查服务器日志；背包物品未被替换。'));
      return 0;
    }
  }

  function refreshTraceAfterRankChange(player, oldRank) {
    if (typeof global.kjsDeathTraceSyncCapacityV1 !== 'function') {
      return '\n阶位已降级；请配套更新death_trace.js，当前尚未确认死亡存储空间刷新。';
    }
    try {
      var result = global.kjsDeathTraceSyncCapacityV1(player, oldRank + 1);
      if (result == null || !result.ok) throw new Error('死亡存档同步接口未确认成功');
      return '\n死亡存储空间已经刷新：' + (oldRank + 1) + ' → ' + result.capacity + '条。' +
        (result.removed > 0 ? '\n后排的' + result.removed + '条超额旧记录已清除（含锁定存档），剩余记录已重新编号。' :
          '\n没有超额记录需要清除；现有记录保留。');
    } catch (error) {
      console.error('[progression] 实时降阶后的死亡存档刷新失败：' + error);
      return '\n阶位已降级，但死亡存储空间刷新失败，请检查服务器日志。';
    }
  }

  // Complete the authoritative inventory read before changing persistent rank data.
  // Only the winning item's full NBT is inspected; unchanged previews are not rewritten.
  function scanInventory(player) {
    if (!(player instanceof Player) || player.getLevel().isClientSide()) return false;
    var id = String(player.getUuid());
    try {
      var detected = inventoryBest(player);
      if (!isFinite(detected.total) || detected.total < 0) throw new Error('Invalid current strength');
      var details = makeItemDetails(detected.stack, detected.total, detected.location);
      var prepared = null, tagText = '';
      if (detected.stack != null && !detected.stack.isEmpty()) {
        try { prepared = detected.stack.toNBT(); tagText = String(prepared); }
        catch (previewError) { tagText = 'unavailable'; }
      }
      var signature = details == null ? '' : JSON.stringify({itemId:details.itemId,itemName:details.itemName,
        total:details.total,location:details.location,enchantments:details.enchantments}) + '/' + tagText;
      var d = rankData(player);
      if (d.getDouble('bestStrength_v1') !== detected.total || liveRecords[id] !== signature ||
          (detected.total === 0 && (String(d.getString('bestItemDetails_v1')) !== '' || d.contains('bestItemPreview_v1', 10)))) {
        d.putDouble('bestStrength_v1', detected.total);
        d.putString('bestItemDetails_v1', details == null ? '' : JSON.stringify(details));
        saveItemPreview(d, detected.stack, 'full', prepared);
        d.putInt('best', 0);
        liveRecords[id] = signature;
      }
      if (!d.getBoolean('manual')) changeRank(player, rankFor(detected.total), 'live');
      delete scanWarnings[id];
      return true;
    } catch (error) {
      var now = nowMs();
      if (scanWarnings[id] == null || now - scanWarnings[id] >= 5000) {
        scanWarnings[id] = now;
        console.error('[progression live] ' + id + ': 本次检测失败，保留原阶位和物品明细：' + error);
      }
      return false;
    }
  }

  // The event item may be a removed stack. Read current slots instead of scoring it.
  global.kjsProgressionV2Observe = function (player, ignoredStack) { return scanInventory(player); };
  global.kjsProgressionRecalculateV1 = scanInventory;

  function rankText(player) {
    var d = rankData(player);
    var rank = rankOf(player);
    return '阶位：' + RANK_NAMES[rank] + '（' + (rank + 1) + '/5）' +
      '\n玩家输出倍率：' + OUTGOING[rank] + '（最终伤害阶段）' +
      '\n击杀非玩家生物：' + CHANCE_TEXT[rank] + '概率额外掉落1个魂缚晶' +
      '\n击杀经验额外加成：+' + XP_BONUS_TEXT[rank] + '（经验点）' +
      '\n当前单件物品最高附魔强度：' + (Math.round(d.getDouble('bestStrength_v1') * 100) / 100) +
      (rank === 4 ? '\n职业重选：无限次（/state class）\n种族重选：无限次（/state race）' :
        '\n职业重选剩余：' + d.getInt('classCredits') + ' 次（/state class）' +
        '\n种族重选：达到5阶后可无限使用 /state race') +
      '\n按当前持有物品的单件最高强度实时评阶，丢弃后自动重新定阶。' +
      '\n自动评阶：' + (d.getBoolean('manual') ? '管理员已暂停，可用 /state auto 恢复' : '开启') +
      (rank < 4 ? '\n下一阶条件：单件物品附魔强度 ≥ ' + THRESHOLDS[rank + 1] : '\n已达到最高阶。');
  }

  function openChoice(source, race) {
    var player = source.getPlayerOrException();
    var d = rankData(player);
    var key = race ? 'raceCredits' : 'classCredits';
    var layer = race ? RACE_LAYER : CLASS_LAYER;
    var unlimited = rankOf(player) === 4;
    if (rankOf(player) < (race ? 4 : 1) || (!unlimited && d.getInt(key) <= 0)) {
      source.sendFailure(Component.literal('当前等级或剩余次数不满足重选条件。'));
      return 0;
    }
    if (OriginsAPI == null || OriginContainer == null) {
      source.sendFailure(Component.literal('未加载匹配的Origins Forge适配；重选次数已保留。'));
      return 0;
    }
    try {
      var registry = OriginsAPI.getLayersRegistry(player.getServer());
      var layerValue = registry.get(new ResourceLocation(layer));
      if (layerValue == null || !layerValue.enabled()) {
        source.sendFailure(Component.literal('缺少或停用了层 ' + layer + '；请检查Origins附属/数据包。次数未扣除。'));
        return 0;
      }
      var container = OriginContainer.get(player).resolve().orElse(null);
      if (container == null || !container.hasAllOrigins()) {
        source.sendFailure(Component.literal('请先完成当前的职业/种族选择，再使用重选次数。'));
        return 0;
      }
      // @s来自本次state命令的玩家上下文，避免裸UUID被玩家参数拒绝。
      // withPermission只提高这一次固定内部命令的上下文权限，不授予玩家OP。
      // 指定单层，只清空该职业/种族层；不使用会清空全部层的无参数命令。
      var command = 'origin gui @s ' + layer;
      var commandSource = source.withPermission(2).withSuppressedOutput();
      // 直接执行dispatcher，语法/目标错误会抛出并记录，避免silent执行吞掉错误。
      var result = player.getServer().getCommands().getDispatcher().execute(command, commandSource);
      if (result > 0) {
        if (!unlimited) d.putInt(key, d.getInt(key) - 1);
        source.sendSuccess(Component.literal('已打开' + (race ? '种族' : '职业') + '重选，' +
          (unlimited ? '5阶可无限重选。' : '消耗1次机会。')), false);
        return 1;
      }
      console.error('[progression] Origins重选返回失败：player=' + player.getUsername() + ', command=' + command + ', result=' + result);
      source.sendFailure(Component.literal('重选命令未成功，次数未扣除，请检查服务器日志。'));
    } catch (error) {
      console.error('[progression] Origins重选失败：' + error);
      source.sendFailure(Component.literal('Origins适配异常，次数未扣除，请检查服务器日志。'));
    }
    return 0;
  }

  function adminRank(source, player, delta) {
    if (!source.hasPermission(2)) return 0;
    var old = rankOf(player);
    var target = Math.max(0, Math.min(4, old + delta));
    if (target === old) {
      source.sendFailure(Component.literal('已经处于' + (delta > 0 ? '最高' : '最低') + '等级。'));
      return 0;
    }
    // 手动调整后暂停自动评阶，否则down后会被背包中的旧装备立即升回去。
    rankData(player).putBoolean('manual', true);
    changeRank(player, target);
    source.sendSuccess(Component.literal(player.getName().getString() + ' → ' + RANK_NAMES[target] +
      '；自动评阶已暂停，管理员用 /state auto <player> 恢复。'), true);
    return 1;
  }

  function resumeAuto(source, player) {
    if (!source.hasPermission(2)) return 0;
    rankData(player).putBoolean('manual', false);
    scanInventory(player);
    source.sendSuccess(Component.literal('已恢复 ' + player.getName().getString() + ' 的自动评阶。'), true);
    return 1;
  }

  function addRankCommands(root) {
    root.then(Commands.literal('details')
      .executes(function (ctx) { return openDetails(ctx.getSource(), 1); })
      .then(Commands.argument('volume', IntArg.integer(1))
        .executes(function (ctx) { return openDetails(ctx.getSource(), IntArg.getInteger(ctx, 'volume')); })));
    root.then(Commands.literal('detail')
      .executes(function (ctx) { return openDetails(ctx.getSource(), 1); })
      .then(Commands.argument('volume', IntArg.integer(1))
        .executes(function (ctx) { return openDetails(ctx.getSource(), IntArg.getInteger(ctx, 'volume')); })));
    root.then(Commands.literal('class').executes(function (ctx) { return openChoice(ctx.getSource(), false); }));
    root.then(Commands.literal('race').executes(function (ctx) { return openChoice(ctx.getSource(), true); }));
    function addStep(name, delta) {
      root.then(Commands.literal(name)
        .requires(function (source) { return source.hasPermission(2); })
        .executes(function (ctx) { var s = ctx.getSource(); return adminRank(s, s.getPlayerOrException(), delta); })
        .then(Commands.argument('player', EntityArgument.player())
          .executes(function (ctx) { return adminRank(ctx.getSource(), EntityArgument.getPlayer(ctx, 'player'), delta); })));
    }
    addStep('up', 1);
    addStep('down', -1);
    root.then(Commands.literal('auto')
      .requires(function (source) { return source.hasPermission(2); })
      .executes(function (ctx) { var s = ctx.getSource(); return resumeAuto(s, s.getPlayerOrException()); })
      .then(Commands.argument('player', EntityArgument.player())
        .executes(function (ctx) { return resumeAuto(ctx.getSource(), EntityArgument.getPlayer(ctx, 'player')); })));
  }

  function statusText(player, elapsed) {
    var factor = multiplierAt(elapsed);
    var d = rankData(player);
    var rank = rankOf(player);
    return rankText(player) + '\n' + '累计在线：' + (elapsed / HOUR_MS).toFixed(2) + ' 小时（' +
      (elapsed / DAY_MS).toFixed(3) + ' 天）' +
      '\n时间倍率：' + factor.toFixed(4) +
      '\n实体来源护甲前伤害：(原伤害 + ' + ((rank + 1) / 2) + ') × ' + factor.toFixed(4) + ' × ' + (1 + (rank + 1) / 5).toFixed(1) +
      '\n非实体来源护甲前伤害：原伤害 × ' + (PLAYER_INCOMING * factor).toFixed(4) +
      '\n生物暴击时将上述实体伤害再乘2；时间倍率上限：4，达到上限需' + CAP_HOURS + '小时' +
      '\n生物暴击概率：25%；非玩家生物最大生命×2';
  }

  // Uses the same formatter and server-authoritative scan as /state.
  global.kjsProgressionStateTextV1 = function (player) {
    scanInventory(player);
    return statusText(player, updateTime(player));
  };

  ForgeEvents.onEvent('net.minecraftforge.event.RegisterCommandsEvent', function (event) {
    var root = Commands.literal('state').executes(function (context) {
      var source = context.getSource();
      var player = source.getPlayerOrException();
      scanInventory(player);
      // KubeJS 的 sendSuccess 接收 Component，不使用原 Java 的 Supplier 重载。
      source.sendSuccess(stateComponent(player, updateTime(player)), false);
      return 1;
    });

    root.then(Commands.literal('reset')
      .requires(function (source) { return source.hasPermission(2); })
      .then(Commands.argument('player', EntityArgument.player())
        .executes(function (context) {
          var source = context.getSource();
          if (!source.hasPermission(2)) return 0;
          var player = EntityArgument.getPlayer(context, 'player');
          setHours(player, 0);
          source.sendSuccess(Component.literal('已将 ' + player.getName().getString() +
            ' 的累计在线时长重置为 0 小时。'), true);
          return 1;
        })));

    root.then(Commands.literal('set')
      .requires(function (source) { return source.hasPermission(2); })
      .then(Commands.argument('number', DoubleArgument.doubleArg(0))
        .then(Commands.argument('player', EntityArgument.player())
          .executes(function (context) {
            var source = context.getSource();
            if (!source.hasPermission(2)) return 0;
            var hours = Number(DoubleArgument.getDouble(context, 'number'));
            // 防止非有限数/极大值污染持久数据；上限为JS可精确表示的整数毫秒范围。
            if (!isFinite(hours) || hours < 0 || hours * HOUR_MS > 9007199254740991) {
              source.sendFailure(Component.literal('时长必须是有效的非负小时数，且不能过大。'));
              return 0;
            }
            var player = EntityArgument.getPlayer(context, 'player');
            setHours(player, hours);
            source.sendSuccess(Component.literal('已设置 ' + player.getName().getString() +
              ' 的时长。\n' + statusText(player, storedTime(player))), true);
            return 1;
          }))));
    addRankCommands(root);
    event.getDispatcher().register(root);
  });

  ForgeEvents.onEvent('net.minecraftforge.event.entity.player.PlayerEvent$PlayerLoggedInEvent', function (event) {
    var player = event.getEntity();
    if (player.getLevel().isClientSide()) return;
    sessionClock[String(player.getUuid())] = nowMs();
    scanInventory(player);
  });

  ForgeEvents.onEvent('net.minecraftforge.event.TickEvent$PlayerTickEvent', function (event) {
    if (String(event.phase) !== 'END' || event.player.getLevel().isClientSide()) return;
    updateTime(event.player);
    scanInventory(event.player);
  });

  ForgeEvents.onEvent('net.minecraftforge.event.entity.player.PlayerEvent$PlayerLoggedOutEvent', function (event) {
    var player = event.getEntity();
    if (player.getLevel().isClientSide()) return;
    updateTime(player);
    delete sessionClock[String(player.getUuid())];
    delete liveRecords[String(player.getUuid())];
    delete scanWarnings[String(player.getUuid())];
  });

  ForgeEvents.onEvent('net.minecraftforge.event.entity.player.PlayerEvent$Clone', function (event) {
    var player = event.getEntity();
    if (player.getLevel().isClientSide()) return;
    var elapsed = updateTime(event.getOriginal());
    player.getPersistentData().put(RANK_KEY, rankData(event.getOriginal()).copy());
    player.getPersistentData().putDouble(TIME_KEY, elapsed);
    player.getPersistentData().putInt(XP_REMAINDER_KEY, event.getOriginal().getPersistentData().getInt(XP_REMAINDER_KEY));
    delete liveRecords[String(player.getUuid())];
    sessionClock[String(player.getUuid())] = nowMs();
  });

  var SlashShootable = null;
  if (Platform.isLoaded('slashblade')) {
    try {
      SlashShootable = Java.loadClass('mods.flammpfeil.slashblade.entity.IShootable');
    } catch (error) {
      console.warn('[combat_rules] 此拔刀剑版本无 IShootable，仍按通用伤害来源解析。');
    }
  }

  function livingOwner(entity) {
    for (var depth = 0; entity != null && depth < 8; depth++) {
      if (entity instanceof Living) return entity;
      if (entity instanceof Projectile || entity instanceof Cloud) {
        entity = entity.getOwner();
      } else if (SlashShootable != null && entity instanceof SlashShootable) {
        entity = entity.getShooter();
      } else {
        return null;
      }
    }
    return null;
  }

  function attacker(source) {
    // KubeJS 已重命名这些方法，不使用 getEntity/getDirectEntity。
    var actual = livingOwner(source.getActual());
    return actual != null ? actual : livingOwner(source.getImmediate());
  }

  // KubeJS 2001的ForgeEvents.onEvent固定NORMAL；通过Forge总线指定HIGHEST。
  // 仍尊重取消事件；同优先级模组的顺序及更早的伤害拦截不由本脚本控制。
  MinecraftForge.EVENT_BUS.addListener(EventPriority.HIGHEST, false, LivingHurtEvent, function (event) {
    if (event.isCanceled()) return;
    var victim = event.getEntity();
    if (victim.getLevel().isClientSide()) return;
    var damage = Number(event.getAmount());
    if (!(damage > 0) || !isFinite(damage)) return;
    var source = event.getSource();
    var owner = attacker(source);
    if (victim instanceof Player) {
      var factor = timeMultiplier(victim);
      // 不要求来源是LivingEntity：无人归属弹射物、TNT、落块等实体同样计算。
      if (source.getActual() != null || source.getImmediate() != null) {
        var tier = rankOf(victim) + 1;
        damage = (damage + tier / 2) * factor * (1 + tier / 5);
      } else {
        // 无实体归属的摔落、溺水、火焰等沿用原来的时间乘区。
        damage *= PLAYER_INCOMING * factor;
      }
    }
    // 保留非玩家生物的1/4双倍暴击；在完整新公式之后乘2。
    if (owner instanceof Living && !(owner instanceof Player)) {
      if (Random.current().nextInt(CRIT_DENOMINATOR) === 0) damage *= CRIT_MULTIPLIER;
    }
    event.setAmount(damage);
  });

  // 这里只缩减玩家输出，不再次应用受伤倍率或暴击。
  ForgeEvents.onEvent('net.minecraftforge.event.entity.living.LivingDamageEvent', function (event) {
    if (event.isCanceled() || event.getEntity().getLevel().isClientSide()) return;
    var damage = Number(event.getAmount());
    if (!(damage > 0) || !isFinite(damage)) return;
    var owner = attacker(event.getSource());
    if (owner instanceof Player) event.setAmount(damage * OUTGOING[rankOf(owner)]);
  });

  // 固定UUID的永久属性修饰符，区块重载/重启不会再次相乘。
  // 迁移旧十倍修饰符，并保持当前生命百分比；不改变原有基础属性或其他模组修饰符。
  ForgeEvents.onEvent('net.minecraftforge.event.entity.EntityJoinLevelEvent', function (event) {
    if (event.getLevel().isClientSide()) return;
    var entity = event.getEntity();
    if (!(entity instanceof Living) || entity instanceof Player || entity instanceof ArmorStand) return;
    var health = entity.getAttribute(Attributes.MAX_HEALTH);
    if (health == null) return;
    var oldMax = Number(entity.getMaxHealth());
    var ratio = oldMax > 0 ? Number(entity.getHealth()) / oldMax : 0;
    var changed = false;
    if (health.getModifier(OLD_HEALTH_ID) != null) {
      health.removeModifier(OLD_HEALTH_ID);
      changed = true;
    }
    if (health.getModifier(HEALTH_ID) == null) {
      health.addPermanentModifier(new AttributeModifier(HEALTH_ID, 'KubeJS progression mob health x2', 1, Operation.MULTIPLY_TOTAL));
      changed = true;
    }
    if (changed) entity.setHealth(Math.max(0, Math.min(entity.getMaxHealth(), ratio * entity.getMaxHealth())));
  });

  // Keep normal XP orbs / Mending behavior. Apply once to a living mob XP event.
  // Integer fifths retain fractional bonuses across kills and normal restarts.
  MinecraftForge.EVENT_BUS.addListener(EventPriority.LOWEST, false,
    Java.loadClass('net.minecraftforge.event.entity.living.LivingExperienceDropEvent'), function (event) {
      if (event.isCanceled()) return;
      var victim = event.getEntity();
      if (victim.getLevel().isClientSide() || victim instanceof Player || victim instanceof ArmorStand) return;
      var player = event.getAttackingPlayer();
      if (!(player instanceof Player)) return;
      var base = Math.floor(Number(event.getDroppedExperience()));
      if (!isFinite(base) || base <= 0) return;
      var bonusUnits = XP_BONUS_UNITS[rankOf(player)];
      if (bonusUnits === 0) return;
      var data = player.getPersistentData();
      var remainder = Math.max(0, Math.min(4, data.getInt(XP_REMAINDER_KEY)));
      var units = base * bonusUnits + remainder;
      var extra = Math.floor(units / 5);
      event.setDroppedExperience(Math.min(2147483647, base + extra));
      data.putInt(XP_REMAINDER_KEY, units % 5);
    });

  // 只添加阶级奖励，不删除/替换传世之刃、LootJS或其他模组的原有掉落。
  // 每个正常死亡掉落事件判定一次，箭矢/可追溯玩家的模组投射物亦可归属。
  MinecraftForge.EVENT_BUS.addListener(EventPriority.LOWEST, false, LivingDropsEvent, function (event) {
    if (event.isCanceled()) return;
    var victim = event.getEntity();
    if (victim.getLevel().isClientSide() || victim instanceof Player || victim instanceof ArmorStand) return;
    var owner = attacker(event.getSource());
    if (owner == null && event.isRecentlyHit()) owner = victim.getKillCredit();
    if (!(owner instanceof Player)) return;
    var chance = CHANCE[rankOf(owner)];
    if (!(chance > 0) || Random.current().nextDouble() >= chance) return;
    var item = Item.of(CRYSTAL_ID, 1);
    if (item.isEmpty()) {
      if (!crystalWarning) {
        console.error('[progression] 找不到物品 ' + CRYSTAL_ID + '，请确认传世之刃已安装。');
        crystalWarning = true;
      }
      return;
    }
    var drop = new ItemEntity(victim.getLevel(), victim.getX(), victim.getY() + 0.25, victim.getZ(), item);
    drop.setDefaultPickUpDelay();
    event.getDrops().add(drop);
  });

})();
console.info('[combat_progression_v2 r2.12] LOADED: 5 ranks, strength thresholds 20/80/200/400, live inventory rank, detail books, mob health x2, soul crystal bonus, pre-armor time x1..4 at 100h, /state');
