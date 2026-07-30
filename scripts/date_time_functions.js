function format_date(date, order, sep) {
  let date_str = ''
  for (const o of order) {
    if (o === 'yyyy') date_str += date.getFullYear()
    else if (o === 'yy') date_str += String(date.getFullYear()).slice(2,4)
    else if (o === 'm') date_str += date.getMonth()
    else if (o === 'mm') date_str += String(date.getMonth() + 1).padStart(2, '0');
    else if (o === 'MM') date_str += date.toLocaleString('default', {month: 'short'})
    else if (o === 'MMM') date_str += date.toLocaleString('default', {month: 'long'})
    else if (o === 'd') date_str += date.getDate()
    else if (o === 'dd') date_str += String(date.getDate()).padStart(2, '0');
    if (sep && order.indexOf(o) !== order.length-1) date_str += sep
  }
  return date_str
}

function format_time(time, order, hour12, sep) {
  let time_str = ''
  for (const o of order) {
    if (o === 'hh') time_str += time.toLocaleString('default', {hour: '2-digit'}).slice(0, 2)
    if (o === 'HH') time_str += time.toLocaleString('default', {hour: '2-digit', hour12: false})
    if (o === 'mm') time_str += time.toLocaleString('default', {minute: 'numeric'}).padStart(2, '0')
    if (o === 'ss') time_str += time.toLocaleString('default', {second: 'numeric'}).padStart(2, '0')
    if (sep && order.indexOf(o) !== order.length-1) time_str += sep
    if (hour12 && order.indexOf(o) === order.length-1) time_str += ' ' + time.toLocaleString('default', {hour: '2-digit'}).slice (3, 5).toUpperCase();
  }
  return time_str
};

module.exports = {format_date, format_time}