import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Customer, OrderDetail, MyOrders } from './pages/Customer';
import { Merchant } from './pages/Merchant';
import './styles.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><Routes><Route path="/" element={<Customer/>}/><Route path="/orders" element={<MyOrders/>}/><Route path="/orders/:id" element={<OrderDetail/>}/><Route path="/merchant/*" element={<Merchant/>}/><Route path="*" element={<main className="empty-page"><h1>页面不存在</h1><a href="/">返回打印首页</a></main>}/></Routes></BrowserRouter></React.StrictMode>);
