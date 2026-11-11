const P = (who, en, ua, when, pic) => ({t:'phrase', who, en, ua, when, pic});  // who: say | hear | write | read (emails); pic: an emoji for words that are easy to picture
const R = (ua, en, pic) => ({t:'recall', ua, en, pic});
const SECTIONS = [
  {label:'Remember', slides:[
    R('Можна записатися на прийом?', 'Can I make an appointment, please?'),
    R('Я вільна в четвер.', 'I’m free on Thursday.'),
    R('Вибачте, я не можу завтра.', 'Sorry, I can’t tomorrow.'),
    R('Так, мені підходить.', 'Yes, that works.'),
    {t:'all', items:[['Can I make an appointment, please?','Можна записатися на прийом?'],['I’m free on Thursday.','Я вільна в четвер.'],['Sorry, I can’t tomorrow.','Вибачте, я не можу завтра.'],['Yes, that works.','Так, мені підходить.']]}
  ]},
  {label:'On the phone', slides:[
    P('say', 'Sorry?', 'Перепрошую? (Повторіть, будь ласка.)', 'Ви не почули. Скажіть як питання: голос угору ↗'),
    P('hear', 'Can I get your name?', 'Як вас звати?', 'Так питає адміністратор.'),
    P('hear', 'How do you spell that?', 'Як це пишеться?', 'Назвіть ім’я по буквах.'),
    P('hear', 'What’s your date of birth?', 'Яка ваша дата народження?', 'Так питають у кожній клініці.'),
    P('say', 'It’s March 12, 1988.', '12 березня 1988 року.', 'Спочатку місяць, потім число, потім рік.'),
    P('say', 'Can you speak slowly, please?', 'Можете говорити повільніше?', 'Людина говорить дуже швидко.'),
    {t:'all', items:[['Sorry?','Перепрошую? (не почула)'],['Can you speak slowly, please?','Можете говорити повільніше?'],['Can I get your name?','Як вас звати?','hear'],['How do you spell that?','Як це пишеться?','hear'],['What’s your date of birth?','Яка ваша дата народження?','hear']]}
  ]},
  {label:'At the dentist', slides:[
    {t:'swap', pre:'I need a ', post:'.', opts:['checkup','cleaning','filling'], ua:['Мені потрібен огляд.','Мені потрібна чистка зубів.','Мені потрібна пломба.']},
    P('say', 'This tooth hurts.', 'Цей зуб болить.', 'Показуєте стоматологу, де болить.'),
    P('hear', 'We need to take an x-ray.', 'Треба зробити рентген.', 'Так каже стоматолог.'),
    P('hear', 'We need to treat two teeth.', 'Треба вилікувати два зуби.', 'Так каже стоматолог після рентгену.'),
    P('say', 'How much will it cost?', 'Скільки це буде коштувати?', 'Питаєте про ціну.'),
    {t:'all', items:[['I need a cleaning.','Мені потрібна чистка зубів.'],['This tooth hurts.','Цей зуб болить.'],['We need to take an x-ray.','Треба зробити рентген.','hear'],['We need to treat two teeth.','Треба вилікувати два зуби.','hear'],['How much will it cost?','Скільки це буде коштувати?']]}
  ]},
  {label:'Role-play', slides:[
    {t:'turn', scene:'📞 Calling the dentist', them:'Good morning, Bright Smile Dental. How can I help you?', cue:'Скажіть, що хочете записатися на прийом.', hint:'Hi. Can I make …?', ans:'Hi. Can I make an appointment, please?'},
    {t:'turn', scene:'📞 Calling the dentist', them:'Sure. What do you need?', cue:'Вам потрібна чистка зубів.', hint:'I need a …', ans:'I need a cleaning.'},
    {t:'turn', scene:'📞 Calling the dentist', them:'OK. Can I get your name?', cue:'Скажіть своє ім’я.', hint:'It’s …', ans:'It’s (your name).'},
    {t:'turn', scene:'📞 Calling the dentist', them:'And what’s your date of birth?', cue:'Адміністратор говорить дуже швидко. Попросіть повторити.', hint:'Одне слово ↗', ans:'Sorry?'},
    {t:'turn', scene:'📞 Calling the dentist', them:'Your date of birth?', cue:'Скажіть дату народження: місяць, число, рік.', hint:'It’s March …', ans:'It’s (month, day, year).'},
    {t:'turn', scene:'📞 Calling the dentist', them:'Thank you. We have tomorrow at 9 a.m.', cue:'Завтра не можете. Ви вільні в четвер.', hint:'Sorry, I can’t tomorrow. I’m free …', ans:'Sorry, I can’t tomorrow. I’m free on Thursday.'},
    {t:'turn', scene:'📞 Calling the dentist', them:'Thursday at 4 p.m.?', cue:'Так, підходить.', hint:'Yes, that …', ans:'Yes, that works.'},
    {t:'turn', scene:'📞 Calling the dentist', them:'Great. See you on Thursday!', cue:'Подякуйте і попрощайтеся.', hint:'Thank …', ans:'Thank you. Bye!'},
    {t:'convo', lines:[
      ['them','Good morning, Bright Smile Dental. How can I help you?'],['me','Hi. Can I make an appointment, please?'],
      ['them','Sure. What do you need?'],['me','I need a cleaning.'],
      ['them','And what’s your date of birth?'],['me','Sorry?'],
      ['them','Your date of birth?'],['me','It’s (month, day, year).'],
      ['them','Thank you. We have tomorrow at 9 a.m.'],['me','Sorry, I can’t tomorrow. I’m free on Thursday.'],
      ['them','Thursday at 4 p.m.?'],['me','Yes, that works.'],
      ['them','Great. See you on Thursday!'],['me','Thank you. Bye!']]}
  ]},
  // {t:'email', subject:'New pattern', lines:['Hi Anna,', '', 'Thanks for your email.', '', 'Best regards,', 'Mariya']}
  //   a whole email on one screen; '' = a blank line; tap a line or ▶ to hear it
  // Song lessons: const SONG = {id:'<YouTube id>'}; then {t:'listen', label:'Part 1', from:'0:00', to:'0:24', start:0, end:24, words:['…']}
  //   (YouTube can't be embedded in an artifact: ▶ opens just that clip in a new tab, with captions on).
  //   Never put song lyrics on a page (copyright): teach short phrases with {t:'word', en, ua, ex, pic} and your own example.
  {label:'My sentences', slides:[{t:'mine'}]}
];
