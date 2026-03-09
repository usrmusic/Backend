import express from "express";
import userRoutes from "./user.route.js";
import clientRoute from "./client.routes.js";
import venueRoutes from "./venue.routes.js";
import supplierRoutes from "./supplier.routes.js";
import equipmentRoutes from "./equipment.routes.js";
import packageRoutes from "./package.routes.js";
import companyRoutes from "./company.routes.js"
import rolePermissionRoutes from "./rolePermission.routes.js";
import emailContentRoutes from "./emailContent.routes.js";
import enquiryRoutes from "./enquiry.routes.js";
import confirmEventsRoutes from "./confirmEvents.routes.js";


const router = express.Router();

const defaultRoutes = [
  {
    path: "/user",
    route: userRoutes,
  },
  {
    path: "/client",
    route: clientRoute
  },
  {
    path: "/venue",
    route: venueRoutes,
  },
  {
    path: "/supplier",
    route: supplierRoutes,
  },
  {
    path: "/equipment",
    route: equipmentRoutes,
  },
  {
    path: "/package",
    route: packageRoutes,
  },{
    path: "/company",
    route: companyRoutes
  },
  {
    path: "/roles-permissions",
    route: rolePermissionRoutes,
  },
  {
    path:'/email-content',  
    route: emailContentRoutes,
  },
  {
    path: "/enquiry",
    route: enquiryRoutes,
  },
  {
    path: "/confirm-event",
    route: confirmEventsRoutes
  }
  // {
  //   path:'/enquiry',
  //   route: enquiryRoutes,
  // }
  // {
  //   path: "/admin",
  //   route: rolePermissionRoutes,
  // },
  // {
  //   path: "/clients",
  //   route: clientRoutes,
  // },
  // {
  //   path: "/venues",
  //   route: venueRoutes,
  // },
  // {
  //   path: "/suppliers",
  //   route: supplierRoutes,
  // },
  // {
  //   path: "/company",
  //   route: companyRoutes,
  // },
  // {
  //   path: "/equipment",
  //   route: equipmentRoutes,
  // },
  // {
  //   path: "/enquiry",
  //   route: enquiryRoutes,
  // },
  // {
  //   path: "/packages/",
  //   route: packageRoutes,
  // },
  // {
  //   path: "/payments",
  //   route: paymentRoutes,
  // },
  // {
  //   path: "/email",
  //   route: emailContentRoutes,
  // },
  // {
  //   path: "/rig-list",
  //   route: rigListRoutes,
  // },
  // {
  //   path: "/contracts",
  //   route: contractRoutes,
  // },
  // {
  //   path: "/reports",
  //   route: reportsRoutes,
  // },
  // {
  //   path: "/todos",
  //   route: todoRoutes,
  // },
  // {
  //   path: "/signatures",
  //   route: signatureRoutes,
  // },
  // {
  //   path: "/calendar",
  //   route: calendarRoutes,
  // },
  // {
  //   path: "/files",
  //   route: filesRoutes,
  // },
];

defaultRoutes.forEach((route) => {
  router.use(route.path, route.route);
});

export default router;
