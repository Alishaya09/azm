// نقطة البداية: دوال React المستخدمة في كل الملفات
const { createContext, useContext, useEffect, useMemo, useRef, useState } = React;

// شعار المشروع: badge = الشعار الكامل، mark = رمز النجمة الدائري للأماكن الصغيرة (src/assets/)
const AzmLogo = ({ variant = 'badge', className = '', alt = 'AZM' }) => <img src={variant === 'mark' ? '/src/assets/azm-mark.png' : '/src/assets/azm-logo.png'} alt={alt} className={['azm-logo', variant, className].join(' ').trim()} draggable="false"/>;
